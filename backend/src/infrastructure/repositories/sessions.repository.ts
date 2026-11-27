import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

/**
 * مستودع جلسات الدخول (auth_sessions) — الجلسة كوكي httpOnly (مواصفة §4.1).
 * انتهاء انزلاقي 12 ساعة نشاط + إبطال فوري عند التعطيل/الخروج.
 */

export const SESSION_TTL_HOURS = 12;
export const SESSION_COOKIE = 'recon_session';

export interface SessionInfo {
  id: string;
  userId: number;
  expiresAt: Date;
}

export class AuthSessionsRepository {
  constructor(private readonly pool: Pool) {}

  async create(userId: number, passwordHash: string, ip: string | null, userAgent: string | null): Promise<string | null> {
    const client = await this.pool.connect();
    const id = randomUUID();
    try {
      await client.query('BEGIN');
      const live = await client.query(
        'SELECT 1 FROM users WHERE id = $1 AND password_hash = $2 AND is_active = true FOR UPDATE',
        [userId, passwordHash],
      );
      if (!live.rowCount) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(
        `INSERT INTO auth_sessions (id, user_id, expires_at, ip, user_agent)
         VALUES ($1, $2, now() + make_interval(hours => $3::int), $4::inet, $5)`,
        [id, userId, SESSION_TTL_HOURS, ip, userAgent?.slice(0, 300) ?? null],
      );
      await client.query('COMMIT');
      return id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** تُعيد userId إن كانت الجلسة حية، وتمدد انتهاءها (انزلاقي) */
  async findLive(sessionId: string): Promise<SessionInfo | null> {
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string; // int8 → نص في pg
      expires_at: Date;
    }>(
      `UPDATE auth_sessions
          SET expires_at = now() + make_interval(hours => $2::int)
        WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()
        RETURNING id, user_id, expires_at`,
      [sessionId, SESSION_TTL_HOURS],
    );
    const row = rows[0];
    return row ? { id: row.id, userId: Number(row.user_id), expiresAt: row.expires_at } : null;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.pool.query(
      'UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
      [sessionId],
    );
  }

  /** إبطال كل جلسات مستخدم (عند التعطيل) */
  async revokeAllForUser(userId: number): Promise<void> {
    await this.pool.query(
      'UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
  }
}
