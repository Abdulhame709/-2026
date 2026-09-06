import { Router } from 'express';
import type { Request, Response } from 'express';
import { AuthService } from '../../application/auth.service.js';
import { createUserSchema } from '../../application/auth.dto.js';
import { requireAuth, requireRole } from '../middleware/session.js';
import { ERR } from '../../domain/errors.js';

/**
 * مسارات المستخدمين — Admin فقط للكتابة (مصفوفة الصلاحيات Stage 1 §4).
 * تنفيذ المسارات بالأسلوب القياسي (تصغير توثيقي على §4.2 — Express 5 لا يدعم :id(\d+):action):
 * GET    /users
 * POST   /users
 * POST   /users/{id}/deactivate | /activate | /force-password-change
 */

function clientIp(req: Request): string | null {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? null;
}

function parseId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw ERR.NOT_FOUND();
  return id;
}

export function usersRoutes(authService: AuthService): Router {
  const router = Router();

  router.use(requireAuth);

  router.get('/', requireRole('admin'), async (_req: Request, res: Response) => {
    res.json({ users: await authService.listUsers() });
  });

  router.post('/', requireRole('admin'), async (req: Request, res: Response) => {
    const input = createUserSchema.parse(req.body);
    const user = await authService.createUser(req.user!, input, clientIp(req));
    res.status(201).json({ user });
  });

  router.post('/:id/deactivate', requireRole('admin'), async (req: Request, res: Response) => {
    const user = await authService.setActive(req.user!, parseId(req), false, clientIp(req));
    res.json({ user });
  });

  router.post('/:id/activate', requireRole('admin'), async (req: Request, res: Response) => {
    const user = await authService.setActive(req.user!, parseId(req), true, clientIp(req));
    res.json({ user });
  });

  router.post(
    '/:id/force-password-change',
    requireRole('admin'),
    async (req: Request, res: Response) => {
      await authService.forcePasswordChange(req.user!, parseId(req), clientIp(req));
      res.status(204).end();
    },
  );

  return router;
}
