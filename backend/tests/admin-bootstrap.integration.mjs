import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { verifyPassword } from '../dist/infrastructure/repositories/users.repository.js';

/**
 * اختبار أمر إنشاء أول مدير (2026-11-28):
 * قاعدة مؤقتة + هجرات كاملة، ثم تشغيل db:create-admin مرة (نجاح) ومرة (رفض التكرار)،
 * والتحقق من الدور وتغيير كلمة المرور الإلزامي وسجل التدقيق.
 */

const databaseName = `reconciliation_admin_bootstrap_${randomBytes(6).toString('hex')}`;
const connection = { host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.PGPASSWORD };
const admin = new pg.Client({ ...connection, database: 'postgres' });
let pool;
let created = false;

const runCreateAdmin = (extraEnv = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'scripts/create-admin.ts', '--apply'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PGHOST: connection.host,
          PGPORT: String(connection.port),
          PGUSER: connection.user,
          PGDATABASE: databaseName,
          ADMIN_USERNAME: 'bootstrapadmin',
          ADMIN_FULL_NAME: 'مدير النشر',
          ADMIN_PASSWORD: 'TempAdmin2026pass',
          ADMIN_CONFIRM: `${databaseName}/bootstrapadmin`,
          ...extraEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

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

  // 1) الإنشاء الأول ينجح
  const first = await runCreateAdmin();
  assert.equal(first.code, 0, `expected success, got: ${first.stderr}`);
  assert.match(first.stdout, /أُنشئ الحساب bootstrapadmin/);

  const user = await pool.query(
    'SELECT id, username, role, must_change_password, password_hash FROM users WHERE username = $1',
    ['bootstrapadmin'],
  );
  assert.equal(user.rowCount, 1);
  assert.equal(user.rows[0].role, 'admin');
  assert.equal(user.rows[0].must_change_password, true);
  assert.notEqual(user.rows[0].password_hash, 'TempAdmin2026pass');
  assert.equal(await verifyPassword(user.rows[0].password_hash, 'TempAdmin2026pass'), true);

  const audit = await pool.query("SELECT actor_id, action, entity_type FROM audit_log WHERE action = 'USER_CREATE'");
  assert.equal(audit.rowCount, 1);
  assert.equal(audit.rows[0].actor_id, null);
  assert.equal(audit.rows[0].entity_type, 'user');

  // 2) التكرار مرفوض بوضوح
  const second = await runCreateAdmin();
  assert.notEqual(second.code, 0);
  assert.match(second.stderr, /مستخدم بالفعل/);

  // 3) تأكيد قاعدة/اسم خاطئ مرفوض
  const wrongConfirm = await runCreateAdmin({ ADMIN_CONFIRM: 'other-db/bootstrapadmin' });
  assert.notEqual(wrongConfirm.code, 0);
  assert.match(wrongConfirm.stderr, /ADMIN_CONFIRM/);

  console.log('PASS: create first admin with forced password change, audit entry and duplicate/confirmation guards');
} finally {
  if (pool) await pool.end();
  if (created && /^reconciliation_admin_bootstrap_[0-9a-f]{12}$/.test(databaseName)) {
    await admin.query(`DROP DATABASE "${databaseName}"`);
  }
  await admin.end().catch(() => undefined);
}
