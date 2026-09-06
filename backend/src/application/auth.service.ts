import type { PublicUser, UserRole } from '../domain/user.js';
import { AppError, ERR } from '../domain/errors.js';
import { UsersRepository, hashPassword, verifyPassword, toPublic } from '../infrastructure/repositories/users.repository.js';
import { AuthSessionsRepository } from '../infrastructure/repositories/sessions.repository.js';
import { AuditRepository } from '../infrastructure/repositories/audit.repository.js';

/**
 * خدمة المصادقة — حالات الاستخدام (طبقة التطبيق، بلا Express):
 * دخول بقفل المحاولات (FR-1.5) · خروج · من-أنا · تغيير مرور (FR-1.4).
 * قواعد الأرقام: قفل 5 محاولات × 5 دقائق (موثق في التوكنز — قابل للضبط بالإعدادات لاحقاً).
 */

export const MAX_ATTEMPTS = 5;
export const LOCK_SECONDS = 300;

export interface LoginResult {
  user: PublicUser;
  sessionId: string;
}

export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: AuthSessionsRepository,
    private readonly audit: AuditRepository,
  ) {}

  async login(username: string, password: string, ip: string | null): Promise<LoginResult> {
    const user = await this.users.findByUsername(username);

    if (!user) {
      await this.audit.write({ actorId: null, action: 'LOGIN_FAILED', entityType: 'user', entityId: username, ip });
      throw ERR.INVALID_CREDENTIALS();
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      const seconds = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000);
      throw ERR.ACCOUNT_LOCKED(seconds);
    }

    if (!user.isActive) {
      await this.audit.write({ actorId: user.id, action: 'LOGIN_BLOCKED_DISABLED', entityType: 'user', entityId: String(user.id), ip });
      throw ERR.ACCOUNT_DISABLED();
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      const attempts = await this.users.registerFailure(user.id, MAX_ATTEMPTS, LOCK_SECONDS);
      await this.audit.write({
        actorId: user.id,
        action: 'LOGIN_FAILED',
        entityType: 'user',
        entityId: String(user.id),
        after: { attempt: attempts, max: MAX_ATTEMPTS },
        ip,
      });
      if (attempts >= MAX_ATTEMPTS) throw ERR.ACCOUNT_LOCKED(LOCK_SECONDS);
      throw ERR.INVALID_CREDENTIALS();
    }

    await this.users.resetFailures(user.id);
    const sessionId = await this.sessions.create(user.id, ip, null);
    await this.audit.write({ actorId: user.id, action: 'LOGIN', entityType: 'user', entityId: String(user.id), ip });
    return { user: toPublic(user), sessionId };
  }

  async logout(sessionId: string, userId: number, ip: string | null): Promise<void> {
    await this.sessions.revoke(sessionId);
    await this.audit.write({ actorId: userId, action: 'LOGOUT', entityType: 'auth_session', entityId: sessionId, ip });
  }

  async resolveSession(sessionId: string): Promise<PublicUser | null> {
    const session = await this.sessions.findLive(sessionId);
    if (!session) return null;
    const user = await this.users.findById(session.userId);
    // مستخدم عُطِّل أثناء جلسته → تُبطل فوراً
    if (!user || !user.isActive) {
      await this.sessions.revoke(sessionId);
      return null;
    }
    return toPublic(user);
  }

  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
    ip: string | null,
  ): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw ERR.UNAUTHENTICATED();

    const ok = await verifyPassword(user.passwordHash, currentPassword);
    if (!ok) throw ERR.WRONG_PASSWORD();

    const newHash = await hashPassword(newPassword);
    await this.users.updatePassword(userId, newHash);
    await this.audit.write({ actorId: userId, action: 'PASSWORD_CHANGED', entityType: 'user', entityId: String(userId), ip });
    return toPublic({ ...user, mustChangePassword: false });
  }

  // ===== إدارة المستخدمين (Admin فقط — تُفحص الصلاحية في المسار) =====

  async listUsers(): Promise<PublicUser[]> {
    return this.users.listAll();
  }

  async createUser(
    actor: { id: number },
    input: { username: string; fullName: string; role: UserRole; initialPassword: string },
    ip: string | null,
  ): Promise<PublicUser> {
    const existing = await this.users.findByUsername(input.username);
    if (existing) throw ERR.USERNAME_TAKEN();

    const created = await this.users.create({
      username: input.username,
      fullName: input.fullName,
      role: input.role,
      passwordHash: await hashPassword(input.initialPassword),
      createdBy: actor.id,
    });
    await this.audit.write({
      actorId: actor.id,
      action: 'USER_CREATE',
      entityType: 'user',
      entityId: String(created.id),
      after: { username: created.username, role: created.role },
      ip,
    });
    return created;
  }

  async setActive(
    actor: { id: number },
    targetId: number,
    isActive: boolean,
    ip: string | null,
  ): Promise<PublicUser> {
    if (actor.id === targetId && !isActive) {
      throw new AppError('SELF_DEACTIVATION', 409, 'لا يمكنك تعطيل حسابك الحالي — استعن بمدير آخر');
    }
    const updated = await this.users.setActive(targetId, isActive);
    if (!updated) throw ERR.NOT_FOUND();
    if (!isActive) await this.sessions.revokeAllForUser(targetId); // إبطال الجلسات فوراً
    await this.audit.write({
      actorId: actor.id,
      action: isActive ? 'USER_ACTIVATE' : 'USER_DEACTIVATE',
      entityType: 'user',
      entityId: String(targetId),
      ip,
    });
    return updated;
  }

  async forcePasswordChange(actor: { id: number }, targetId: number, ip: string | null): Promise<void> {
    const target = await this.users.findById(targetId);
    if (!target) throw ERR.NOT_FOUND();
    await this.users.setMustChangePassword(targetId, true);
    await this.audit.write({
      actorId: actor.id,
      action: 'USER_FORCE_PASSWORD_CHANGE',
      entityType: 'user',
      entityId: String(targetId),
      ip,
    });
  }
}
