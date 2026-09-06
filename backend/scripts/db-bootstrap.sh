#!/usr/bin/env bash
# تهيئة PostgreSQL المحلي — سكربت مضمن وقابل لإعادة التشغيل بأمان (idempotent).
# الثنائيات: ~/.cache/pg (خارج المستودع) — البيانات: backend/.pgdata (متجاهلة من Git).
set -euo pipefail

PG_ROOT="$HOME/.cache/pg"
PKG_DIR="$PG_ROOT/package"
DATA_DIR="$(cd "$(dirname "$0")/.." && pwd)/.pgdata"
PORT=5432

export LD_LIBRARY_PATH="$PKG_DIR/native/lib:${LD_LIBRARY_PATH:-}"
export PATH="$PKG_DIR/native/bin:$PATH"

# 1) تنزيل الثنائيات إن لم توجد
if [ ! -x "$PKG_DIR/native/bin/postgres" ]; then
  echo "⟳ تنزيل ثنائيات PostgreSQL عبر npm…"
  mkdir -p "$PG_ROOT"
  cd "$PG_ROOT"
  npm pack @embedded-postgres/linux-x64@latest --silent
  tar -xzf embedded-postgres-linux-x64-*.tgz
  cd "$PKG_DIR"
  node scripts/hydrate-symlinks.js 2>/dev/null || node -e '
    const fs=require("fs");
    const links=JSON.parse(fs.readFileSync("native/pg-symlinks.json","utf8"));
    for(const l of links){ if(!fs.existsSync(l.target)) fs.symlinkSync(l.source,l.target); }
    console.log("symlinks OK");'
fi

# 2) تهيئة عنقود البيانات إن لم يوجد
if [ ! -f "$DATA_DIR/PG_VERSION" ]; then
  echo "⟳ تهيئة عنقود بيانات جديد…"
  initdb -D "$DATA_DIR" -U postgres -E UTF8 --locale=C --auth=trust >/dev/null
fi

# 3) تشغيل الخادم إن لم يكن يعمل
if ! pg_ctl -D "$DATA_DIR" status >/dev/null 2>&1; then
  echo "⟳ تشغيل الخادم على المنفذ $PORT…"
  pg_ctl -D "$DATA_DIR" -o "-p $PORT -c listen_addresses=127.0.0.1" -l "$PG_ROOT/pg.log" start
  sleep 1
fi

# 4) إنشاء قاعدة reconciliation إن لم توجد
if ! node -e "
import('pg').then(async ({default: pg}) => {
  const c = new pg.Client({host:'127.0.0.1',port:$PORT,user:'postgres',database:'postgres'});
  await c.connect();
  const r = await c.query(\"SELECT 1 FROM pg_database WHERE datname='reconciliation'\");
  console.log(r.rowCount === 0 ? 'MISSING' : 'OK');
  await c.end();
});" | grep -q OK; then
  echo "⟳ إنشاء قاعدة البيانات reconciliation…"
  node -e "
import('pg').then(async ({default: pg}) => {
  const c = new pg.Client({host:'127.0.0.1',port:$PORT,user:'postgres',database:'postgres'});
  await c.connect();
  await c.query('CREATE DATABASE reconciliation');
  console.log('✓ أُنشئت reconciliation');
  await c.end();
});"
fi

echo "✅ PostgreSQL جاهز على 127.0.0.1:$PORT"
