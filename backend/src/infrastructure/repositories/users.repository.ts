import { hash as argon2hash, verify as argon2verify } from '@node-rs/argon2';
import type { Pool } from 'pg';
import type { PublicUser, User, UserRole } from '../../domain/user.js';

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
      'SELECT * FROM users WHERE lower(username) = lower($1)',
      [username],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findById(id: number): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async listAll(): Promise<PublicUser[]> {
    const { rows } = await this.pool.query<UserRow>(
      'SELECT * FROM users ORDER BY is_active DESC, id',
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
    const { rows } = await this.pool.query<UserRow>(
      `INSERT INTO users (username, password_hash, full_name, role, must_change_password)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.username, input.passwordHash, input.fullName, input.role, input.mustChangePassword ?? true],
    );
    return toPublic(toUser(rows[0]));
  }

  async setActive(id: number, isActive: boolean): Promise<PublicUser | null> {
    const { rows } = await this.pool.query<UserRow>(
      `UPDATE users SET is_active = $2 WHERE id = $1 RETURNING *`,
      [id, isActive],
    );
    return rows[0] ? toPublic(toUser(rows[0])) : null;
  }

  async setMustChangePassword(id: number, must: boolean): Promise<void> {
    await this.pool.query('UPDATE users SET must_change_password = $2 WHERE id = $1', [id, must]);
  }

  async updatePassword(id: number, newPasswordHash: string): Promise<void> {
    await this.pool.query(
      'UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1',
      [id, newPasswordHash],
    );
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
