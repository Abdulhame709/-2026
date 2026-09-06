#!/usr/bin/env node
/**
 * مشغّل الهجرات — يطبق ملفات SQL المرتبة مرة واحدة لكل ملف ويسجلها في schema_migrations.
 * الاستخدام: node scripts/migrate.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'infrastructure', 'db', 'migrations');
const DB_NAME = process.env.PGDATABASE ?? 'reconciliation';

const pool = new pg.Pool({
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  database: DB_NAME,
});

async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✓ طُبِّقت: ${file}`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`✗ فشلت ${file}:`, err.message);
      process.exitCode = 1;
      break;
    } finally {
      client.release();
    }
  }

  if (count === 0) console.log('لا هجرات جديدة — المخطط محدث.');
  else console.log(`طُبِّق ${count} ملف هجرة على «${DB_NAME}».`);
}

main()
  .catch((err) => {
    console.error('خطأ الهجرات:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
