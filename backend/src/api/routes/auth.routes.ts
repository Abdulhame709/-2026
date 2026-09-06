import { Router } from 'express';
import type { Request, Response } from 'express';
import { AuthService } from '../../application/auth.service.js';
import { loginSchema, changePasswordSchema } from '../../application/auth.dto.js';
import { SESSION_COOKIE } from '../../infrastructure/repositories/sessions.repository.js';
import { requireAuth } from '../middleware/session.js';

/**
 * مسارات المصادقة — POST /auth/login · /auth/logout · /auth/change-password · GET /auth/me
 * الكوكي: httpOnly + SameSite=Strict + secure تلقائي خلف HTTPS.
 */

export function authRoutes(authService: AuthService): Router {
  const router = Router();

  router.post('/login', async (req: Request, res: Response) => {
    const input = loginSchema.parse(req.body);
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? null;

    const { user, sessionId } = await authService.login(input.username, input.password, ip);

    // سياسة الكوكي حسب السياق (D10-bis + قيد معاينة المنصة):
    // - اسم محلي (localhost / IP شبكة مباشر) → SameSite=Strict (الأشد — ويشمل إنتاج LAN على http).
    // - أي نطاق حقيقي آخر (نفق معاينة arena.site / e2b.app أو دومين إنتاج) → None+Secure+Partitioned
    //   لأن المعاينة تعمل داخل إطار مقيّد في موقع آخر والمتصفح يرفض كوكي Strict فيه صمتاً.
    //   (Partitioned/CHIPS تجعله مقبولاً حتى مع حجب كوكيز الأطر الثالثة).
    // للإنتاج بنطاق واحد يمكن التشديد بـ COOKIE_SAMESITE=strict.
    const rawHost = (req.headers.host ?? '').toLowerCase();
    const hostName = rawHost.split(':')[0] ?? '';
    const isLocalHost =
      hostName === 'localhost' ||
      hostName === '127.0.0.1' ||
      hostName === '::1' ||
      hostName.startsWith('169.254.') ||
      hostName.startsWith('192.168.') ||
      hostName.startsWith('10.');
    const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
    const isHttps = proto === 'https' || req.secure;
    const sameSite = (process.env.COOKIE_SAMESITE as 'strict' | 'lax' | 'none' | undefined) ??
      (isLocalHost ? 'strict' : 'none');

    res.cookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite,
      secure: sameSite === 'none' ? true : isHttps, // None يتطلب Secure وإلا رفضه المتصفح
      // CHIPS: كوكي مُقسَّم حسب الموقع الرئيسي — يقبله المتصفح داخل الإطارات
      // حتى مع تفعيل حجب كوكيز الأطر الثالثة (Partitioned يتطلب None+Secure).
      ...(sameSite === 'none' ? { partitioned: true } : {}),
      path: '/',
      maxAge: 12 * 60 * 60 * 1000,
    });
    // قناة الجلسة البديلة (B): نسكب الرمز مع كل دخول — الكوكي يبقى الآلية الأساسية،
    // والواجهة تستخدم الرمز فقط إن فشل الكوكي (إطار المعاينة). سبب الإلغاء الشرطي:
    // بوابة نفق المعاينة تعيد كتابة ترويسات المضيف فلا يمكن الاعتماد على كشف السياق.
    // في النشر الداخلي (LAN) النظام أول طرف والرمز احتياط غير مؤذٍ —
    // ويمكن تعطيل الإصدار كلياً لاحقاً بـ ISSUE_BEARER_TOKEN=off.
    const issueToken = process.env.ISSUE_BEARER_TOKEN !== 'off';
    res.json({ user, ...(issueToken ? { token: sessionId } : {}) });
  });

  router.post('/logout', requireAuth, async (req: Request, res: Response) => {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? null;
    await authService.logout(req.sessionId!, req.user!.id, ip);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req: Request, res: Response) => {
    res.json({ user: req.user });
  });

  router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
    const input = changePasswordSchema.parse(req.body);
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? null;
    const user = await authService.changePassword(req.user!.id, input.currentPassword, input.newPassword, ip);
    res.json({ user });
  });

  return router;
}
