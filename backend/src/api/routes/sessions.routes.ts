import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { SessionService } from '../../application/sessions.service.js';
import type { MatchingService } from '../../application/matching.service.js';
import type { ReportExportService } from '../../application/report-export.service.js';
import { requireAuth, requireRole } from '../middleware/session.js';
import { ERR } from '../../domain/errors.js';
import { parseId, clientIp } from './shared.js';

/**
 * مسارات جلسات المطابقة (Module 4):
 * POST  /sessions                        إنشاء جلسة (حساب+فترة) — 409 إن وُجدت مفتوحة
 * GET   /sessions                        قائمة مع نسب التقدم
 * GET   /sessions/{id}                  تفصيل كامل (شاشة العمل في نداء واحد)
 * POST  /sessions/{id}/suggest          توليد/تجديد الاقتراحات (المحرك)
 * POST  /sessions/{id}/groups           ربط يدوي (سحب وإفلات) — مؤكد مباشرة
 * POST  /sessions/{id}/close            إغلاق بلقطة ملخص
 * POST  /sessions/{id}/reopen           إعادة فتح (أدمن)
 * POST  /match-groups/{id}/confirm      قبول اقتراح
 * POST  /match-groups/{id}/reject       رفض اقتراح (يُحفظ لمنع التكرار)
 * POST  /match-groups/{id}/unlink       فك ربط مؤكد
 * PATCH /match-groups/{id}/allocations  تعديل حصص التوزيع
 */

const createSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  periodLabel: z.string().trim().min(7).max(7),
  openingBalance: z.coerce.number().optional().nullable(),
  openingTheirs: z.coerce.number().optional().nullable(),
  carriedFromSessionId: z.coerce.number().int().positive().optional().nullable(),
  openingAdjustReason: z.string().trim().max(500).optional().nullable(),
});

const itemsSchema = z
  .array(
    z.object({
      lineId: z.coerce.number().int().positive(),
      allocated: z.coerce.number().optional().nullable(),
    }),
  )
  .min(2, 'الربط يحتاج بنداً من كل جهة على الأقل');

const manualSchema = z.object({
  items: itemsSchema,
  note: z.string().trim().max(300).optional().nullable(),
});

const allocationsSchema = z.object({ items: itemsSchema });

export function sessionsRoutes(sessionSvc: SessionService, matchingSvc: MatchingService, exportSvc: ReportExportService): Router {
  const router = Router();
  const canWrite = requireRole('admin', 'reconciler');

  router.post('/', requireAuth, canWrite, async (req: Request, res: Response) => {
    const input = createSchema.parse(req.body);
    const session = await sessionSvc.create(req.user!.id, input, clientIp(req));
    res.status(201).json({ session });
  });

  router.get('/', requireAuth, async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const sessions = await sessionSvc.list(status);
    res.json({ sessions });
  });

  // === تعديل/حذف الجلسات (طلب المالك): تعديل المفتوحة فقط — الحذف لأدمن وللفارغة فقط ===
  const updateSessionSchema = z.object({
    periodLabel: z.string().trim().regex(/^\d{4}-\d{2}$/, 'صيغة الفترة YYYY-MM').optional(),
    openingOurs: z.coerce.number().optional().nullable(),
    openingTheirs: z.coerce.number().optional().nullable(),
    openingAdjustReason: z.string().trim().max(500).optional().nullable(),
  });

  router.patch('/:id', requireAuth, canWrite, async (req: Request, res: Response) => {
    const patch = updateSessionSchema.parse(req.body);
    const session = await sessionSvc.updateOpen(req.user!.id, parseId(req), patch, clientIp(req));
    res.json({ session });
  });

  router.delete('/:id', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    res.json(await sessionSvc.remove(req.user!.id, parseId(req), clientIp(req)));
  });

  // === تصدير تقرير الجلسة محلياً (Module 10): Excel + PDF خلفي بخط عربي مضمّن ===
  router.get('/:id/export.xlsx', requireAuth, async (req: Request, res: Response) => {
    const { buffer, filename } = await exportSvc.excel(parseId(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  router.get('/:id/report.pdf', requireAuth, async (req: Request, res: Response) => {
    const { buffer, filename } = await exportSvc.pdf(parseId(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  // === اقتراح الافتتاحي (D9): ختامي آخر جلسة مغلقة لنفس الحساب — قبل /:id ===
  router.get('/opening-suggestion', requireAuth, async (req: Request, res: Response) => {
    const accountId = Number(req.query.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      throw ERR.VALIDATION([{ field: 'accountId', messageAr: 'معرف الحساب مطلوب لاقتراح الافتتاحي' }]);
    }
    res.json({ suggestion: await sessionSvc.openingSuggestion(accountId) });
  });

  // === مجموعات المطابقة (قبل /:id حتى لا تلتقط المسارات العامة المعامل رقمياً) ===
  router.post('/groups/:id/confirm', requireAuth, canWrite, async (req: Request, res: Response) => {
    const result = await matchingSvc.confirm(req.user!.id, parseId(req), clientIp(req));
    res.json(result);
  });

  router.post('/groups/:id/reject', requireAuth, canWrite, async (req: Request, res: Response) => {
    const result = await matchingSvc.reject(req.user!.id, parseId(req), clientIp(req));
    res.json(result);
  });

  router.post('/groups/:id/unlink', requireAuth, canWrite, async (req: Request, res: Response) => {
    const result = await matchingSvc.unlink(req.user!.id, parseId(req), clientIp(req));
    res.json(result);
  });

  router.patch('/groups/:id/allocations', requireAuth, canWrite, async (req: Request, res: Response) => {
    const { items } = allocationsSchema.parse(req.body);
    const result = await matchingSvc.adjustAllocations(
      req.user!.id,
      parseId(req),
      items.map((i) => ({ lineId: i.lineId, allocated: i.allocated ?? null })),
      clientIp(req),
    );
    res.json(result);
  });

  router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    res.json(await sessionSvc.detail(parseId(req)));
  });

  router.post('/:id/suggest', requireAuth, canWrite, async (req: Request, res: Response) => {
    const result = await matchingSvc.suggest(req.user!.id, parseId(req), clientIp(req));
    res.json(result);
  });

  router.post('/:id/groups', requireAuth, canWrite, async (req: Request, res: Response) => {
    const input = manualSchema.parse(req.body);
    const result = await matchingSvc.manualGroup(
      req.user!.id,
      parseId(req),
      input.items.map((i) => ({ lineId: i.lineId, allocated: i.allocated ?? null })),
      input.note ?? null,
      clientIp(req),
    );
    res.status(201).json(result);
  });

  router.post('/:id/close', requireAuth, canWrite, async (req: Request, res: Response) => {
    const summary = await sessionSvc.close(req.user!.id, parseId(req), clientIp(req));
    res.json({ summary });
  });

  router.post('/:id/reopen', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    const session = await sessionSvc.reopen(req.user!.id, parseId(req), clientIp(req));
    res.json({ session });
  });

  return router;
}
