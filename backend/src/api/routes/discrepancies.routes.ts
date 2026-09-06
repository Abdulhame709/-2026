import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { DiscrepancyService } from '../../application/discrepancy.service.js';
import { requireAuth, requireRole } from '../middleware/session.js';
import { ERR } from '../../domain/errors.js';
import { parseId, clientIp } from './shared.js';

/**
 * مسارات الفروق (Module 5 + تعليقات Module 7):
 * GET    /discrepancies?sessionId=&status=&accountId=  القائمة مع الفلاتر
 * PATCH  /discrepancies/{id}                           حالة/مسؤول/سبب/ملاحظة
 * POST   /discrepancies/{id}/carry                     ترحيل لجلسة مفتوحة بنفس الحساب
 * GET    /discrepancies/{id}/comments                  تعليقات فرق (الجميع)
 * POST   /discrepancies/{id}/comments                  إضافة ملاحظة (الجميع — قرار المالك)
 * GET    /discrepancies/session/{sid}/comments         ملاحظات كل فروق جلسة (للتقرير المطبوع)
 * DELETE /discrepancies/comments/{cid}                 حذف ملاحظة (صاحبها أو مدير)
 * GET    /reason-codes                                 أسباب الفروق الجاهزة (الجميع)
 */

const updateSchema = z
  .object({
    status: z.enum(['new', 'in_progress', 'resolved', 'accepted']).optional(),
    assigneeId: z.preprocess((v) => (v === '' || v === undefined || v === null ? null : Number(v)), z.number().int().positive().nullable()).optional(),
    reasonCodeId: z.preprocess((v) => (v === '' || v === undefined || v === null ? null : Number(v)), z.number().int().positive().nullable()).optional(),
    resolutionNote: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(500).nullable()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'لا تغييرات في الطلب' });

const carrySchema = z.object({ targetSessionId: z.coerce.number().int().positive() });

const commentSchema = z.object({
  body: z.string().trim().min(1, 'اكتب الملاحظة أولاً').max(2000, 'الملاحظة أطول من 2000 حرف — اختصرها أو قسّمها'),
});

export function discrepanciesRoutes(svc: DiscrepancyService): Router {
  const router = Router();
  const canWrite = requireRole('admin', 'reconciler');

  router.get('/', requireAuth, async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId ? Number(req.query.sessionId) : undefined;
    const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
    const discrepancies = await svc.list({ sessionId, status, accountId });
    res.json({ discrepancies });
  });

  router.patch('/:id', requireAuth, canWrite, async (req: Request, res: Response) => {
    const patch = updateSchema.parse(req.body);
    const discrepancy = await svc.update(req.user!.id, parseId(req), patch, clientIp(req));
    res.json({ discrepancy });
  });

  router.post('/:id/carry', requireAuth, canWrite, async (req: Request, res: Response) => {
    const { targetSessionId } = carrySchema.parse(req.body);
    const result = await svc.carry(req.user!.id, parseId(req), targetSessionId, clientIp(req));
    res.json(result);
  });

  // ===== تعليقات الفروق (Module 7) — الجميع يعلّق (قرار المالك) =====

  router.get('/:id/comments', requireAuth, async (req: Request, res: Response) => {
    res.json({ comments: await svc.listComments(parseId(req)) });
  });

  router.post('/:id/comments', requireAuth, async (req: Request, res: Response) => {
    const { body } = commentSchema.parse(req.body);
    const comment = await svc.addComment(req.user!.id, parseId(req), body, clientIp(req));
    res.status(201).json({ comment });
  });

  router.get('/session/:sessionId/comments', requireAuth, async (req: Request, res: Response) => {
    const sessionId = Number(req.params.sessionId);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      throw ERR.VALIDATION([{ field: 'sessionId', messageAr: 'معرف الجلسة غير صالح' }]);
    }
    res.json({ comments: await svc.listSessionComments(sessionId) });
  });

  router.delete('/comments/:commentId', requireAuth, async (req: Request, res: Response) => {
    const commentId = Number(req.params.commentId);
    if (!Number.isInteger(commentId) || commentId <= 0) {
      throw ERR.VALIDATION([{ field: 'commentId', messageAr: 'معرف الملاحظة غير صالح' }]);
    }
    const isAdmin = req.user!.role === 'admin';
    res.json(await svc.deleteComment(req.user!.id, isAdmin, commentId, clientIp(req)));
  });

  return router;
}

export function reasonCodesRoutes(svc: DiscrepancyService): Router {
  const router = Router();
  router.get('/', requireAuth, async (_req: Request, res: Response) => {
    res.json({ reasonCodes: await svc.listReasonCodes() });
  });
  return router;
}
