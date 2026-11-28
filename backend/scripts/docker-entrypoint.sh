#!/bin/sh
# نقطة دخول الحاوية: هجرات القاعدة ثم الخادم.
# الهجرات آمنة التكرار (schema_migrations)، وتُعطَّل بـRUN_MIGRATIONS=0
# عندما تتولاها خدمة migrate منفصلة في compose.
set -e

if [ "${RUN_MIGRATIONS:-1}" != "0" ]; then
  echo "⏳ تطبيق هجرات القاعدة…"
  node scripts/migrate.mjs
fi

exec "$@"
