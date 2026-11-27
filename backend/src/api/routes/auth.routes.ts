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
    const ip = req.ip ?? null;

    const { user, sessionId } = await authService.login(input.username, input.password, ip);

    const isHttps = req.secure;
    const configuredSameSite = process.env.COOKIE_SAMESITE;
    const sameSite = configuredSameSite === 'none' || configuredSameSite === 'lax' ? configuredSameSite : 'strict';

    res.setHeader('Cache-Control', 'no-store');
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
    const issueToken = process.env.ISSUE_BEARER_TOKEN === 'on';
    res.json({ user, ...(issueToken ? { token: sessionId } : {}) });
  });

  router.post('/logout', requireAuth, async (req: Request, res: Response) => {
    const ip = req.ip ?? null;
    await authService.logout(req.sessionId!, req.user!.id, ip);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req: Request, res: Response) => {
    res.json({ user: req.user });
  });

  router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
    const input = changePasswordSchema.parse(req.body);
    const ip = req.ip ?? null;
    const user = await authService.changePassword(req.user!.id, input.currentPassword, input.newPassword, ip, req.sessionId!);
    res.json({ user });
  });

  return router;
}
