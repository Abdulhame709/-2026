import { hash as argon2hash, verify as argon2verify } from '@node-rs/argon2';
import type { Pool } from 'pg';
import type { PublicUser, User, UserRole } from '../../domain/user.js';
import { ERR } from '../../domain/errors.js';

/**
 * مستودع المستخدمين — التنفيذ الوحيد المعتمد على pg.
 * الواجهة الضمنية: الدوال التي تحتاجها خدمات التطبيق فقط.
 */

const ARGON_OPTS = {
  // إعدادات Argon2id الافتراضية الآمنة (OWASP): memory 19MiB, iterations 2, parallelism 1
  algorithm: 2, // Argon2id
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2hash(plain, ARGON_OPTS);
}

export function verifyPassword(hashValue: string, plain: string): Promise<boolean> {
  return argon2verify(hashValue, plain);
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
  failed_attempts: number;
  locked_until: Date | null;
  created_at: Date;
}

function toUser(row: UserRow): User {
  return {
    id: Number(row.id),
    username: row.username,
    passwordHash: row.password_hash,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    failedAttempts: Number(row.failed_attempts),
    lockedUntil: row.locked_until,
    createdAt: row.created_at,
  };
}

export function toPublic(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    isActive: user.isActive,
  };
}

export class UsersRepository {
  constructor(private readonly pool: Pool) {}

  async findByUsername(username: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>(
      'SELECT * FROM users WHERE lower(username) = lower($1) AND deleted_at IS NULL',
      [username],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findById(id: number): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async listAll(): Promise<PublicUser[]> {
    const { rows } = await this.pool.query<UserRow>(
      'SELECT * FROM users WHERE deleted_at IS NULL ORDER BY is_active DESC, id',
    );
    return rows.map((r) => toPublic(toUser(r)));
  }

  async create(input: {
    username: string;
    fullName: string;
    role: UserRole;
    passwordHash: string;
    createdBy: number;
    mustChangePassword?: boolean;
  }): Promise<PublicUser> {
    try {
      const { rows } = await this.pool.query<UserRow>(
        `INSERT INTO users (username, password_hash, full_name, role, must_change_password)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [input.username, input.passwordHash, input.fullName, input.role, input.mustChangePassword ?? true],
      );
      return toPublic(toUser(rows[0]));
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw ERR.USERNAME_TAKEN();
      throw error;
    }
  }

  async updateManaged(
    id: number,
    actorId: number,
    input: { username: string; fullName: string; role: UserRole },
    ip: string | null,
  ): Promise<PublicUser | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<UserRow>('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
      if (!current.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const oldUser = current.rows[0];
      const updated = await client.query<UserRow>(
        'UPDATE users SET username = $2, full_name = $3, role = $4 WHERE id = $1 RETURNING *',
        [id, input.username, input.fullName, input.role],
      );
      if (oldUser.username !== input.username || oldUser.role !== input.role) {
        await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      }
      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, before, after, ip)
         VALUES ($1, 'USER_UPDATE', 'user', $2, $3::jsonb, $4::jsonb, $5::inet)`,
        [actorId, String(id), JSON.stringify({ username: oldUser.username, fullName: oldUser.full_name, role: oldUser.role }),
          JSON.stringify({ username: input.username, fullName: input.fullName, role: input.role }), ip],
      );
      await client.query('COMMIT');
      return toPublic(toUser(updated.rows[0]));
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') throw ERR.USERNAME_TAKEN();
      throw error;
    } finally {
      client.release();
    }
  }

  async archive(id: number, actorId: number, ip: string | null): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<UserRow>(
        `UPDATE users SET is_active = false, must_change_password = true, deleted_at = now()
         WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [id],
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, after, ip)
         VALUES ($1, 'USER_ARCHIVE', 'user', $2, $3::jsonb, $4::inet)`,
        [actorId, String(id), JSON.stringify({ username: rows[0].username, role: rows[0].role }), ip],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setActive(id: number, isActive: boolean): Promise<PublicUser | null> {
    const { rows } = await this.pool.query<UserRow>(
      `UPDATE users SET is_active = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [id, isActive],
    );
    return rows[0] ? toPublic(toUser(rows[0])) : null;
  }

  async replacePassword(id: number, oldHash: string, newHash: string, currentSessionId: string, ip: string | null): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        'UPDATE users SET password_hash = $3, must_change_password = false, failed_attempts = 0, locked_until = NULL WHERE id = $1 AND password_hash = $2 AND deleted_at IS NULL',
        [id, oldHash, newHash],
      );
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [id, currentSessionId]);
      await client.query(
        'INSERT INTO audit_log (actor_id, action, entity_type, entity_id, ip) VALUES ($1, $2, $3, $4, $5::inet)',
        [id, 'PASSWORD_CHANGED', 'user', String(id), ip],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async forcePasswordChange(id: number, actorId: number, ip: string | null): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query('UPDATE users SET must_change_password = true WHERE id = $1 AND deleted_at IS NULL', [id]);
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      await client.query(
        'INSERT INTO audit_log (actor_id, action, entity_type, entity_id, ip) VALUES ($1, $2, $3, $4, $5::inet)',
        [actorId, 'USER_FORCE_PASSWORD_CHANGE', 'user', String(id), ip],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** تسجيل محاولة فاشلة + القفل عند 5 (FR-1.5) */
  async registerFailure(id: number, maxAttempts: number, lockSeconds: number): Promise<number> {
    const { rows } = await this.pool.query<UserRow>(
      `UPDATE users
         SET failed_attempts = failed_attempts + 1,
             locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + make_interval(secs => $3::int) ELSE locked_until END
       WHERE id = $1
       RETURNING failed_attempts, locked_until`,
      [id, maxAttempts, lockSeconds],
    );
    return Number(rows[0].failed_attempts);
  }

  async resetFailures(id: number): Promise<void> {
    await this.pool.query(
      'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1',
      [id],
    );
  }
}
