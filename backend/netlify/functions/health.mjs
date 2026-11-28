import pg from 'pg';

/**
 * فحص تشغيلي مؤقت: هل يستطيع Netlify Function الوصول إلى Neon عبر TCP؟
 * يُستخدم مرة واحدة لاختيار منصة الاستضافة ثم يُحذف.
 */
export default async () => {
  const started = Date.now();
  let ok = false;
  let detail = '';
  try {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 1,
      connectionTimeoutMillis: 6000,
    });
    const r = await pool.query(
      "select current_database() as db, (select count(*)::int from schema_migrations) as migrations",
    );
    detail = `${r.rows[0].db}/${r.rows[0].migrations}`;
    ok = true;
    await pool.end();
  } catch (e) {
    detail = `${e.code ?? ''} ${e.message}`.trim();
  }
  return new Response(
    JSON.stringify({ ok, detail, ms: Date.now() - started, node: process.version }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
};
