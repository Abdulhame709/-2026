import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import pg from 'pg';
import { BackupService } from '../dist/application/backup.service.js';
import { AuditRepository } from '../dist/infrastructure/repositories/audit.repository.js';

const backupName = process.argv[2];
if (!backupName || !/^backup-[A-Za-z0-9._-]+\.enc$/.test(backupName)) {
  throw new Error('Provide the exact encrypted backup filename.');
}
if (!process.env.PGPASSWORD) throw new Error('PGPASSWORD must be set for the isolated rehearsal.');

const databaseName = `reconciliation_rehearsal_${randomBytes(8).toString('hex')}`;
const tempRoot = await mkdtemp(join(tmpdir(), 'reconciliation-rehearsal-'));
const uploadDir = join(tempRoot, 'uploads');
const connection = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD,
};
const admin = new pg.Client({ ...connection, database: 'postgres' });
let pool;
let created = false;

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  console.log(`Temporary rehearsal database: ${databaseName}`);
  pool = new pg.Pool({ ...connection, database: databaseName });
  const migrations = join(process.cwd(), 'src', 'infrastructure', 'db', 'migrations');
  for (const name of (await readdir(migrations)).filter((file) => file.endsWith('.sql')).sort()) {
    await pool.query((await readFile(join(migrations, name))).toString('utf8'));
  }

  const service = new BackupService(pool, new AuditRepository(pool), resolve('storage/backups'), uploadDir);
  const backup = (await service.list()).find((item) => item.name === backupName);
  if (!backup?.readable || !backup.includesUploads) throw new Error('Backup is not a readable database-and-files archive.');
  await service.restore(backupName, { id: 0, username: 'isolated-rehearsal' }, null);

  const { rows: sources } = await pool.query('SELECT stored_path, sha256 FROM source_files');
  for (const source of sources) {
    assert.equal(dirname(resolve(source.stored_path)), resolve(uploadDir));
    const content = await readFile(source.stored_path);
    assert.equal(createHash('sha256').update(content).digest('hex'), source.sha256.toLowerCase());
  }
  const { rows: settings } = await pool.query("SELECT value FROM settings WHERE key='company'");
  const logo = settings[0]?.value?.logoFileName;
  if (logo) await readFile(join(uploadDir, logo));
  const { rows: sessions } = await pool.query('SELECT count(*)::int AS total FROM auth_sessions');
  assert.equal(sessions[0].total, 0);
  assert.equal((await readdir(uploadDir)).length, backup.fileCount);
  console.log(`Rehearsal passed: ${backup.fileCount} files restored; login sessions excluded.`);
} finally {
  let cleanupError;
  if (pool) {
    try {
      await pool.end();
    } catch (error) {
      cleanupError = error;
    }
  }
  if (created && /^reconciliation_rehearsal_[0-9a-f]{16}$/.test(databaseName)) {
    try {
      await admin.query(`DROP DATABASE "${databaseName}"`);
      console.log('Temporary rehearsal database removed.');
    } catch (error) {
      console.error(`CRITICAL: remove temporary database ${databaseName} manually; it contains restored data.`);
      cleanupError = error;
    }
  }
  await admin.end().catch(() => undefined);
  if (dirname(resolve(tempRoot)) !== resolve(tmpdir()) || !basename(tempRoot).startsWith('reconciliation-rehearsal-')) {
    throw new Error('Unsafe rehearsal cleanup path.');
  }
  if (cleanupError) {
    console.error(`CRITICAL: temporary restored files remain at ${tempRoot}.`);
    throw cleanupError;
  }
  try {
    await rm(tempRoot, { recursive: true, force: true });
  } catch (error) {
    console.error(`CRITICAL: remove temporary restored files at ${tempRoot} manually.`);
    throw error;
  }
}
