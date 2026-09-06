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

  async create(userId: number, ip: string | null, userAgent: string | null): Promise<string> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO auth_sessions (id, user_id, expires_at, ip, user_agent)
       VALUES ($1, $2, now() + make_interval(hours => $3::int), $4::inet, $5)`,
      [id, userId, SESSION_TTL_HOURS, ip, userAgent?.slice(0, 300) ?? null],
    );
    return id;
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
