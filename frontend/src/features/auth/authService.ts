/**
 * خدمة المصادقة الحقيقية — تستدعي الخادم عبر البروكسي (نفس الأصل):
 * POST /api/v1/auth/login · /logout · GET /me · POST /change-password
 * القفل والعدادات في الخادم (5 محاولات × 5 دقائق) — الواجهة فقط تعرض الرسالة والعد.
 */
import { api, ApiError, storeSessionToken } from '@/shared/api/client';
import type { AppUser } from './mockUsers';

interface MeResponse {
  user: AppUser;
}

export async function login(username: string, password: string): Promise<AppUser> {
  const { user, token } = await api.post<MeResponse & { token?: string }>('/api/v1/auth/login', {
    username,
    password,
  });
  // قناة بديلة للإطارات المقيّدة: يأتي الرمز فقط حين يعلم الخادم أن الكوكي مرفوض
  storeSessionToken(token ?? null);
  return user;
}

/** خروج بجهود حسنة: إن انتهت الجلسة في الخادم مسبقاً (401) نعتبر الخروج تمّاً —
 * الفشل الشبكي لا يمنع تنظيف الحالة المحلية ولا يُرمى للمتصفح كرفض معلّق. */
export async function logout(): Promise<void> {
  try {
    await api.post<void>('/api/v1/auth/logout');
  } catch {
    // الجلسة غير موجودة أصلاً (401) أو الشبكة مقطوعة — التنظيف المحلي يكفي
  } finally {
    storeSessionToken(null);
  }
}

export async function fetchMe(): Promise<AppUser | null> {
  try {
    const { user } = await api.get<MeResponse>('/api/v1/auth/me');
    return user;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 0)) return null;
    throw err;
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<AppUser> {
  const { user } = await api.post<MeResponse>('/api/v1/auth/change-password', {
    currentPassword,
    newPassword,
  });
  return user;
}

/** يفحص هل الخطأ = قفل حساب ويستخرج ثواني الانتظار (للعد التنازلي في شاشة الدخول). */
export function lockSecondsFrom(err: unknown): number | null {
  if (err instanceof ApiError && err.code === 'ACCOUNT_LOCKED') {
    const d = err.details as { retryAfterSeconds?: number } | undefined;
    return d?.retryAfterSeconds ?? 300;
  }
  return null;
}

export function formatRemaining(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s} ثانية`;
}
