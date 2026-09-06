import pg from 'pg';

/**
 * مجمع الاتصالات الوحيد بقاعدة البيانات (طبقة البنية).
 * الإعدادات من البيئة مع قيم افتراضية تطابق سكربت التهيئة.
 */
export const pool = new pg.Pool({
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.PGDATABASE ?? 'reconciliation',
  max: 10,
  idleTimeoutMillis: 30_000,
});
