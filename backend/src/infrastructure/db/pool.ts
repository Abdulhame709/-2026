import pg from 'pg';

/**
 * مجمع الاتصالات الوحيد بقاعدة البيانات (طبقة البنية).
 * الإعدادات من البيئة مع قيم افتراضية تطابق سكربت التهيئة.
 *
 * السحابة المُدارة (Neon/Render/Supabase) تعطي رابطاً واحداً بـSSL؛ لذا:
 *   - DATABASE_URL يتقدّم على PGHOST/PGUSER… إن وُجد.
 *   - PGSSL=disable يمنع SSL (شبكة داخلية موثوقة فقط)، وPGSSL=require يفرضه.
 *     بلا هذين، SSL يُفعَّل تلقائياً عند استخدام DATABASE_URL.
 */
const connectionString = process.env.DATABASE_URL?.trim();
const sslMode = process.env.PGSSL?.trim().toLowerCase();
const ssl = sslMode === 'disable'
  ? false
  : connectionString || sslMode === 'require'
    ? { rejectUnauthorized: false }
    : undefined;

export const pool = new pg.Pool({
  ...(connectionString
    ? { connectionString }
    : {
        host: process.env.PGHOST ?? '127.0.0.1',
        port: Number(process.env.PGPORT ?? 5432),
        user: process.env.PGUSER ?? 'postgres',
        database: process.env.PGDATABASE ?? 'reconciliation',
      }),
  ...(ssl === undefined ? {} : { ssl }),
  max: 10,
  idleTimeoutMillis: 30_000,
});
