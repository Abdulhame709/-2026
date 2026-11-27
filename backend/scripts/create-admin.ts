/**
 * إنشاء أول حساب مدير في قاعدة جديدة (مثلاً أول نشر سحابي).
 *
 * البذور `db:seed` مقصورة على التطوير لأنها تضيف موردين تجريبيين؛ هذا الأمر
 * يضيف حساب مدير واحداً فقط بكلمة مرور تُمرَّر عبر البيئة وتُحذف من الذاكرة،
 * ويجعل تغييرها إلزامياً عند أول دخول.
 *
 * الاستخدام:
 *   ADMIN_USERNAME=admin ADMIN_FULL_NAME="مدير النظام" \
 *   ADMIN_PASSWORD='...' ADMIN_CONFIRM="reconciliation/admin" \
 *   npm run db:create-admin -- --apply
 *
 * كلمة المرور لا تُطبع ولا تُسجَّل، ويجب ألا تدخل Git أو سجل الأوامر الدائم.
 */
import pg from 'pg';
import { securePasswordSchema } from '../src/application/auth.dto.js';
import { hashPassword } from '../src/infrastructure/repositories/users.repository.js';

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/i;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--apply') {
    throw new Error('الاستخدام: npm run db:create-admin -- --apply');
  }

  const host = process.env.PGHOST;
  const database = process.env.PGDATABASE;
  const username = process.env.ADMIN_USERNAME?.trim();
  if (!host || !database || !process.env.PGUSER || !process.env.PGPASSWORD || !username) {
    throw new Error('عيّن PGHOST وPGDATABASE وPGUSER وPGPASSWORD وADMIN_USERNAME صراحة');
  }
  if (!USERNAME_RE.test(username)) throw new Error('اسم المستخدم غير صالح (3–30 حرفاً: حروف/أرقام/نقطة/شرطة/سفلية)');
  if (process.env.ADMIN_CONFIRM !== `${database}/${username}`) {
    throw new Error(`اضبط ADMIN_CONFIRM بالقيمة ${database}/${username} لتأكيد قاعدة البيانات والاسم`);
  }

  const password = securePasswordSchema.parse(process.env.ADMIN_PASSWORD);
  delete process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_FULL_NAME?.trim() || 'مدير النظام';

  const pool = new pg.Pool({
    host,
    database,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    port: Number(process.env.PGPORT ?? 5432),
    max: 1,
  });

  try {
    const client = await pool.connect();
    try {
      const existing = await client.query(
        'SELECT 1 FROM users WHERE lower(username) = lower($1) AND deleted_at IS NULL',
        [username],
      );
      if (existing.rowCount) {
        throw new Error(`اسم المستخدم ${username} مستخدم بالفعل في ${database}؛ استخدم db:rotate لتدوير كلمته`);
      }

      const passwordHash = await hashPassword(password);
      await client.query('BEGIN');
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO users (username, password_hash, full_name, role, must_change_password)
           VALUES ($1, $2, $3, 'admin', true)
           RETURNING id`,
          [username, passwordHash, fullName],
        );
        await client.query(
          `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, after)
           VALUES (NULL, 'USER_CREATE', 'user', $1, $2::jsonb)`,
          [rows[0].id, JSON.stringify({ username, role: 'admin', source: 'cli' })],
        );
        await client.query('COMMIT');
        console.log(`أُنشئ الحساب ${username} (admin) في ${database}؛ تغيير كلمة المرور إلزامي عند أول دخول`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('فشل إنشاء حساب المدير:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
