import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import express from 'express';
import pg from 'pg';
import { statementsRoutes } from '../dist/api/routes/statements.routes.js';
import { errorHandler } from '../dist/api/middleware/error.js';
import { StatementService } from '../dist/application/statement.service.js';
import { AccountsRepository } from '../dist/infrastructure/repositories/partners.repository.js';
import { TemplatesRepository } from '../dist/infrastructure/repositories/templates.repository.js';
import { StatementsRepository } from '../dist/infrastructure/repositories/statements.repository.js';
import { AuditRepository } from '../dist/infrastructure/repositories/audit.repository.js';
import { AuthSessionsRepository } from '../dist/infrastructure/repositories/sessions.repository.js';
import { hashPassword } from '../dist/infrastructure/repositories/users.repository.js';

/**
 * اختبار تكامل HTTP لمسار الاستيراد الفعلي (2026-11-28):
 * فحص الأعمدة ← رفع بخريطة مؤكدة وحفظ قالب ← اعتماد، على قاعدة PostgreSQL مؤقتة.
 * يغطي المسار الذي لا تغطيه اختبارات الوحدة (multipart/Zod/المسارات).
 */

const databaseName = `reconciliation_statements_http_${randomBytes(6).toString('hex')}`;
const connection = { host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.PGPASSWORD };
const admin = new pg.Client({ ...connection, database: 'postgres' });
let pool;
let server;
let created = false;
let uploadDir;

const csv = Buffer.from(
  'التاريخ,نوع المستند,رقم المستند,البيان,المرجع,مدين,دائن,العملة\n'
  + '2026-03-06,فاتورة,INV-1,فاتورة مشتريات,INV-1,1465,,YER\n'
  + '2026-03-07,سداد,PAY-1,سداد جزء,PAY-1,,465,YER\n',
);

try {
  if (!process.env.PGPASSWORD) throw new Error('اضبط PGPASSWORD للاختبار المعزول فقط');
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  pool = new pg.Pool({ ...connection, database: databaseName });

  const migrations = join(process.cwd(), 'src', 'infrastructure', 'db', 'migrations');
  for (const name of (await readdir(migrations)).filter((file) => file.endsWith('.sql')).sort()) {
    await pool.query((await readFile(join(migrations, name))).toString('utf8'));
  }

  await pool.query("INSERT INTO currencies (code,name_ar,symbol) VALUES ('YER','ريال يمني','ر.ي') ON CONFLICT (code) DO NOTHING");
  const partner = await pool.query("INSERT INTO partners (code,name_ar) VALUES ('SUP-HTTP','مورد اختبار') RETURNING id");
  const account = await pool.query(
    "INSERT INTO accounts (partner_id,currency_code) VALUES ($1,'YER') RETURNING id",
    [Number(partner.rows[0].id)],
  );
  const accountId = Number(account.rows[0].id);
  const actor = await pool.query(
    "INSERT INTO users (username,password_hash,full_name,role) VALUES ('tester',$1,'Test Actor','admin') RETURNING id",
    [await hashPassword(`A1${randomBytes(24).toString('hex')}`)],
  );
  const actorId = Number(actor.rows[0].id);

  uploadDir = await mkdtemp(join(tmpdir(), 'reconciliation-statements-http-'));
  const service = new StatementService(
    new AccountsRepository(pool),
    new TemplatesRepository(pool),
    new StatementsRepository(pool),
    new AuditRepository(pool),
    new AuthSessionsRepository(pool),
    uploadDir,
  );

  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.user = {
      id: actorId,
      username: 'tester',
      fullName: 'Test Actor',
      role: request.get('x-test-role') === 'viewer' ? 'viewer' : 'admin',
      isActive: true,
      mustChangePassword: false,
    };
    next();
  });
  app.use('/statements', statementsRoutes(service, { suggest: async () => ({ suggested: 0, autoConfirmed: 0 }) }, {}));
  app.use(errorHandler);
  server = await new Promise((done) => {
    const listening = app.listen(0, '127.0.0.1', () => done(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}/statements`;

  const postFile = (path, fields, headers = {}) => {
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'statement.csv');
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
    return fetch(`${base}${path}`, { method: 'POST', body: form, headers });
  };

  // 1) الفحص: تعرّف على الأعمدة الثمانية واقتراح الخريطة الصحيحة
  const inspectResponse = await postFile('/inspect', { accountId, side: 'theirs' });
  assert.equal(inspectResponse.status, 201);
  const { inspection } = await inspectResponse.json();
  assert.equal(inspection.headerRows, 1);
  assert.deepEqual(inspection.mapping, {
    date: 'A', docType: 'B', docNo: 'C', description: 'D', ref: 'E', debit: 'F', credit: 'G', currency: 'H',
  });
  assert.ok(inspection.warnings.some((warning) => warning.includes('العملة')));

  // 2) الرفع بخريطة مؤكدة وحفظ القالب
  const uploadResponse = await postFile('/upload', {
    accountId,
    side: 'theirs',
    templateId: '',
    mapping: JSON.stringify(inspection.mapping),
    headerRows: 1,
    decimalSep: inspection.decimalSep,
    thousandSep: inspection.thousandSep,
    saveTemplate: JSON.stringify({ name: 'ملف مورد 8 أعمدة', isDefault: true }),
  });
  assert.equal(uploadResponse.status, 201, JSON.stringify(await uploadResponse.clone().json()));
  const preview = await uploadResponse.json();
  assert.equal(preview.lineCount, 2);
  assert.equal(preview.mapping.date, 'A');
  assert.deepEqual([preview.lines[0].debitRaw, preview.lines[0].creditRaw], ['1465', '']);
  assert.ok(preview.templateId > 0);
  const savedTemplate = await pool.query('SELECT account_id,template_kind,columns_mapping FROM import_templates WHERE id=$1', [preview.templateId]);
  assert.equal(Number(savedTemplate.rows[0].account_id), accountId);
  assert.equal(savedTemplate.rows[0].template_kind, 'theirs');
  assert.equal(savedTemplate.rows[0].columns_mapping.date, 'A');

  // 3) الاعتماد: كتابة الكشف وبنوده في معاملة واحدة
  const commitResponse = await fetch(`${base}/preview/${preview.token}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ openingBalance: 0, announcedClosing: 1000 }),
  });
  assert.equal(commitResponse.status, 201, JSON.stringify(await commitResponse.clone().json()));
  const committed = await commitResponse.json();
  assert.deepEqual([committed.lineCount, committed.totalDebit, committed.totalCredit], [2, 1465, 465]);

  const detail = await (await fetch(`${base}/${committed.statementId}`)).json();
  assert.equal(detail.statement.status, 'committed');
  assert.equal(detail.lines.length, 2);

  // 4) رفض الخريطة غير الصالحة ورفض دور القراءة
  const missingDate = await postFile('/upload', {
    accountId, side: 'theirs', templateId: '', mapping: JSON.stringify({ description: 'D', debit: 'F' }),
  });
  assert.equal(missingDate.status, 422);
  assert.equal((await missingDate.json()).error.code, 'VALIDATION_FAILED');

  const duplicateColumn = await postFile('/upload', {
    accountId, side: 'theirs', templateId: '', mapping: JSON.stringify({ date: 'A', debit: 'F', credit: 'F' }),
  });
  assert.equal(duplicateColumn.status, 422);

  const forbidden = await postFile('/inspect', { accountId, side: 'theirs' }, { 'x-test-role': 'viewer' });
  assert.equal(forbidden.status, 403);

  console.log('PASS: HTTP inspect → mapped upload → saved template → commit, with validation and role checks');
} finally {
  if (server) await new Promise((done) => server.close(done));
  if (pool) await pool.end();
  if (uploadDir) {
    if (dirname(resolve(uploadDir)) !== resolve(tmpdir())) throw new Error('Unsafe test cleanup path');
    await rm(uploadDir, { recursive: true, force: true });
  }
  if (created && /^reconciliation_statements_http_[0-9a-f]{12}$/.test(databaseName)) {
    await admin.query(`DROP DATABASE "${databaseName}"`);
  }
  await admin.end().catch(() => undefined);
}
