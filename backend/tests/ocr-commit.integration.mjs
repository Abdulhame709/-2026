import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import express from 'express';
import pg from 'pg';
import { statementsRoutes } from '../dist/api/routes/statements.routes.js';
import { errorHandler } from '../dist/api/middleware/error.js';
import { StatementService } from '../dist/application/statement.service.js';
import { AccountsRepository } from '../dist/infrastructure/repositories/partners.repository.js';
import { StatementsRepository } from '../dist/infrastructure/repositories/statements.repository.js';
import { SessionsRepository } from '../dist/infrastructure/repositories/reconciliation-sessions.repository.js';
import { AuditRepository } from '../dist/infrastructure/repositories/audit.repository.js';

const databaseName = `reconciliation_ocr_test_${randomBytes(6).toString('hex')}`;
const uploadDir = await mkdtemp(join(tmpdir(), 'reconciliation-ocr-db-'));
const connection = { host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.PGPASSWORD };
const admin = new pg.Client({ ...connection, database: 'postgres' });
let pool;
let server;
let created = false;

try {
  if (!process.env.PGPASSWORD) throw new Error('اضبط PGPASSWORD محلياً قبل الاختبار؛ لا تستخدم قاعدة العمل');
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  pool = new pg.Pool({ ...connection, database: databaseName });
  const migrations = join(process.cwd(), 'src', 'infrastructure', 'db', 'migrations');
  for (const name of (await readdir(migrations)).filter((file) => file.endsWith('.sql')).sort()) {
    await pool.query((await readFile(join(migrations, name))).toString('utf8'));
  }

  const user = await pool.query(
    'INSERT INTO users (username, password_hash, full_name, role) VALUES ($1,$2,$3,$4) RETURNING id',
    ['ocr_test', 'synthetic-only', 'Synthetic User', 'admin'],
  );
  const actorId = Number(user.rows[0].id);
  const partner = await pool.query('INSERT INTO partners (code, name_ar) VALUES ($1,$2) RETURNING id', ['SYN-1', 'مورد اختباري']);
  const account = await pool.query('INSERT INTO accounts (partner_id, currency_code) VALUES ($1,$2) RETURNING id', [partner.rows[0].id, 'USD']);
  const accountId = Number(account.rows[0].id);
  const session = await pool.query(
    'INSERT INTO reconciliation_sessions (account_id, currency_code, period_label, created_by) VALUES ($1,$2,$3,$4) RETURNING id',
    [accountId, 'USD', '2026-02', actorId],
  );
  const sessionId = Number(session.rows[0].id);
  const service = new StatementService(
    new AccountsRepository(pool),
    { getById: async () => null },
    new StatementsRepository(pool),
    new AuditRepository(pool),
    new SessionsRepository(pool),
    uploadDir,
  );
  let suggestions = 0;
  const matching = { suggest: async () => { suggestions++; return { suggested: 0, autoConfirmed: 0 }; } };
  const ocr = { extractPdf: async () => ({
    pages: 1,
    mode: 'ocr',
    opening: 20,
    lines: [{ lineNo: 1, dateRaw: '2026-02-01', description: 'Invoice', ref: 'INV-42', debitRaw: '100', creditRaw: '', ocrConfidence: 0.83 }],
  }) };
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.user = { id: actorId, username: 'ocr_test', role: 'admin', isActive: true, mustChangePassword: false };
    next();
  });
  app.use('/statements', statementsRoutes(service, matching, ocr));
  app.use(errorHandler);
  server = await new Promise((done) => {
    const listening = app.listen(0, '127.0.0.1', () => done(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}/statements`;
  const original = Buffer.from('%PDF-1.7 synthetic OCR input');
  const forged = await fetch(`${base}/manual`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      accountId,
      side: 'ours',
      lines: [{ entryDate: '2026-02-01', description: 'Invoice', debit: 100, ocrConfidence: 0.83 }],
    }),
  });
  assert.equal(forged.status, 422);

  async function upload(side) {
    const form = new FormData();
    form.append('accountId', String(accountId));
    form.append('side', side);
    form.append('file', new Blob([original], { type: 'application/pdf' }), `synthetic-${side}.pdf`);
    const response = await fetch(`${base}/ocr`, { method: 'POST', body: form });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.ok(body.token && body.draft.lines.length === 1);
    return body.token;
  }

  async function commit(token, closing) {
    const response = await fetch(`${base}/preview/${token}/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, openingBalance: 20, announcedClosing: closing, announcedCount: 1 }),
    });
    return { status: response.status, body: await response.json() };
  }

  const ourToken = await upload('ours');
  const correction = await fetch(`${base}/preview/${ourToken}/lines/1`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ debitRaw: '100.0001' }),
  });
  assert.equal(correction.status, 200);
  assert.equal((await commit(ourToken, -80)).status, 422);
  assert.equal((await pool.query('SELECT count(*)::int AS total FROM statements')).rows[0].total, 0);
  const ourCommit = await commit(ourToken, -80.0001);
  assert.equal(ourCommit.status, 201);
  assert.equal(suggestions, 0);

  const theirToken = await upload('theirs');
  const theirCommit = await commit(theirToken, 120);
  assert.equal(theirCommit.status, 201);
  assert.equal(suggestions, 1);
  const linked = await pool.query('SELECT our_statement_id, their_statement_id FROM reconciliation_sessions WHERE id=$1', [sessionId]);
  assert.equal(Number(linked.rows[0].our_statement_id), ourCommit.body.statementId);
  assert.equal(Number(linked.rows[0].their_statement_id), theirCommit.body.statementId);
  const files = await pool.query('SELECT stored_path, original_name FROM source_files ORDER BY original_name');
  assert.equal(files.rows.length, 2);
  for (const file of files.rows) assert.ok((await readFile(file.stored_path)).equals(original));
  const lines = await pool.query('SELECT ocr_confidence, needs_review FROM statement_lines WHERE statement_id=$1', [ourCommit.body.statementId]);
  assert.equal(Number(lines.rows[0].ocr_confidence), 0.83);
  assert.equal(lines.rows[0].needs_review, true);
  console.log('PASS: isolated OCR upload, archived originals, totals and automatic matching');
} finally {
  if (server) await new Promise((done) => server.close(done));
  if (pool) await pool.end();
  if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end().catch(() => undefined);
  if (dirname(resolve(uploadDir)) !== resolve(tmpdir()) || !basename(uploadDir).startsWith('reconciliation-ocr-db-')) {
    throw new Error('Unsafe OCR test cleanup path');
  }
  await rm(uploadDir, { recursive: true, force: true });
}
