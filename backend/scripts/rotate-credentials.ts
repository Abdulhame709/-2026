import pg from 'pg';
import { securePasswordSchema } from '../src/application/auth.dto.js';
import { hashPassword, verifyPassword } from '../src/infrastructure/repositories/users.repository.js';

async function main(): Promise<void> {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length || (mode !== '--check' && mode !== '--apply')) {
    throw new Error('الاستخدام: npm run db:rotate -- --check أو npm run db:rotate -- --apply');
  }

  const host = process.env.PGHOST;
  const database = process.env.PGDATABASE;
  const username = process.env.ROTATE_USERNAME?.trim();
  if (!host || !database || !process.env.PGUSER || !process.env.PGPASSWORD || !username) {
    throw new Error('عيّن PGHOST وPGDATABASE وPGUSER وPGPASSWORD وROTATE_USERNAME صراحة');
  }
  if (!/^[a-z0-9._-]{3,30}$/i.test(username)) throw new Error('اسم المستخدم المستهدف غير صالح');

  let newPassword: string | undefined;
  if (mode === '--apply') {
    if (process.env.ROTATE_CONFIRM !== `${database}/${username}`) {
      throw new Error(`اضبط ROTATE_CONFIRM بالقيمة ${database}/${username} لتأكيد قاعدة البيانات والحساب`);
    }
    newPassword = securePasswordSchema.parse(process.env.ROTATE_NEW_PASSWORD);
    delete process.env.ROTATE_NEW_PASSWORD;
  }

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
      if (mode === '--check') {
        const { rows } = await client.query<{
          username: string;
          is_active: boolean;
          must_change_password: boolean;
          active_sessions: number;
        }>(
          `SELECT u.username, u.is_active, u.must_change_password,
                  count(s.id)::int AS active_sessions
             FROM users u
             LEFT JOIN auth_sessions s ON s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()
            WHERE lower(u.username) = lower($1)
            GROUP BY u.id`,
          [username],
        );
        if (!rows.length) throw new Error(`الحساب ${username} غير موجود في قاعدة ${database}`);
        console.log({ database, host, ...rows[0] });
        return;
      }

      const nextHash = await hashPassword(newPassword!);
      await client.query('BEGIN');
      try {
        const { rows } = await client.query<{ id: string; password_hash: string }>(
          'SELECT id, password_hash FROM users WHERE lower(username) = lower($1) FOR UPDATE',
          [username],
        );
        const target = rows[0];
        if (!target) throw new Error(`الحساب ${username} غير موجود في قاعدة ${database}`);
        if (await verifyPassword(target.password_hash, newPassword!)) {
          throw new Error('كلمة المرور الجديدة مطابقة للحالية؛ لم يُنفّذ التدوير');
        }
        await client.query(
          'UPDATE users SET password_hash = $2, must_change_password = true, failed_attempts = 0, locked_until = NULL WHERE id = $1',
          [target.id, nextHash],
        );
        const revoked = await client.query(
          'UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
          [target.id],
        );
        await client.query(
          `INSERT INTO audit_log (actor_id, action, entity_type, entity_id)
           VALUES (NULL, 'CREDENTIAL_ROTATION', 'user', $1)`,
          [target.id],
        );
        await client.query('COMMIT');
        console.log(`دُوِّرت كلمة مرور ${username} في ${database} وأُبطلت ${revoked.rowCount ?? 0} جلسة؛ تغييرها إلزامي عند الدخول`);
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
  console.error('فشل تدوير الحساب:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
