import type { NextFunction, Request, Response } from 'express';
import { AuthService } from '../../application/auth.service.js';
import { SESSION_COOKIE } from '../../infrastructure/repositories/sessions.repository.js';
import type { PublicUser } from '../../domain/user.js';

/** توسعة طلب Express بالمستخدم الحالي */
declare module 'express-serve-static-core' {
  interface Request {
    user?: PublicUser;
    sessionId?: string;
  }
}

/** يقرأ الجلسة من الكوكي أو من ترويسة Bearer (قناة بديلة للإطارات المقيّدة) ويعبئ req.user */
export function sessionMiddleware(authService: AuthService) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const raw = req.headers.cookie;
    const cookieSession = raw
      ? raw
          .split(';')
          .map((c) => c.trim())
          .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
          ?.slice(SESSION_COOKIE.length + 1)
      : undefined;
    // قناة بديلة 1: Authorization: Bearer <sid> — لمتصفحات ترفض الكوكيز داخل iframe
    const authz = req.headers.authorization;
    const bearerSession = authz?.startsWith('Bearer ') ? authz.slice(7).trim() : undefined;
    // قناة بديلة 2: ?sid=<sid> في الرابط — بوابة نفق المعاينة تَنزِع ترويسة Authorization
    // أثناء العبور (مُثبت بسجل الخادم)، أما معامل الاستعلام فلا تلمسه أي بوابة.
    // الأولوية: الكوكي (الإنتاج) ثم Bearer ثم sid. ملاحظة أمان: sid في الرابط قد
    // يظهر بسجلات الوسطاء — مقبول لبيئة المعاينة، والإنتاج الداخلي يعتمد الكوكي.
    const qs = req.query as { sid?: unknown };
    const sidQuery = typeof qs.sid === 'string' && qs.sid ? qs.sid : undefined;
    const sessionId = cookieSession ?? bearerSession ?? sidQuery;

    if (sessionId) {
      try {
        const user = await authService.resolveSession(sessionId);
        if (user) {
          req.user = user;
          req.sessionId = sessionId;
        }
      } catch (err) {
        // جلسة فاشلة = زائر غير مصادق، لكن الخطأ لا يُبتلع بصمت — يُسجل للمراجعة
        console.error('[session] فشل فحص الجلسة:', err);
      }
    }
    next();
  };
}

/** حارس صلاحية بالأدوار — الاستخدام: requireRole('admin') أو requireRole('admin','reconciler') */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', messageAr: 'غير مسجل الدخول' } });
    return;
  }
  next();
}

export function requireRole(...roles: NonNullable<PublicUser['role']>[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', messageAr: 'غير مسجل الدخول' } });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', messageAr: 'لا تملك صلاحية لهذا الإجراء' } });
      return;
    }
    next();
  };
}
