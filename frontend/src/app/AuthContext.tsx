import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AppUser, Role } from '@/features/auth/mockUsers';
import { storeSessionToken } from '@/shared/api/client';
import * as authService from '@/features/auth/authService';

/**
 * حالة المصادقة الحقيقية — الجلسة كوكي httpOnly من الخادم (مواصفة API §4.1):
 * لا يُخزَّن المستخدم في JS إطلاقاً؛ عند فتح التطبيق نسأل الخادم من-أنا (GET /me).
 */
interface AuthState {
  user: AppUser | null;
  /** قيد فحص الجلسة الأولي — يمنع قفزة التحويل لشاشة الدخول قبل جواب الخادم */
  booting: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [booting, setBooting] = useState(true);

  // استعادة الجلسة من الكوكي/الرمز عند أول تحميل — وإن لم تعد جلسة صالحة نمسح الرمز القديم
  useEffect(() => {
    authService
      .fetchMe()
      .then((u) => {
        setUser(u);
        if (!u) storeSessionToken(null);
      })
      .catch(() => setUser(null))
      .finally(() => setBooting(false));
  }, []);

  // شفاء ذاتي: أي 401 من الخادم والجلسة غير صالحة → تصفير فوري للهوية (لا حالة شبحية)
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('recon:unauthorized', onUnauthorized);
    return () => window.removeEventListener('recon:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const logged = await authService.login(username, password);
    setUser(logged);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const fresh = await authService.fetchMe();
    setUser(fresh);
  }, []);

  const hasRole = useCallback(
    (...roles: Role[]) => (user ? roles.includes(user.role) : false),
    [user],
  );

  const value = useMemo(
    () => ({ user, booting, login, logout, refreshUser, hasRole }),
    [user, booting, login, logout, refreshUser, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth يجب أن يُستخدم داخل AuthProvider');
  return ctx;
}
