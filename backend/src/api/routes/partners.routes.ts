import { Router } from 'express';
import type { Request, Response } from 'express';
import type { PartnerService } from '../../application/partner.service.js';
import { createPartnerSchema, updatePartnerSchema, createAccountSchema } from '../../application/partner.dto.js';
import { requireAuth, requireRole } from '../middleware/session.js';
import { parseId, clientIp } from './shared.js';

/**
 * مسارات الشركاء وحساباتهم (Module 2):
 * GET  /partners                       — القائمة بالحسابات (الجميع)
 * POST /partners                       — إنشاء (Admin, Reconciler) — الرمز هجين
 * GET  /partners/{id}                  — تفصيل بالحسابات (الجميع)
 * PUT  /partners/{id}                  — تعديل/تعطيل/تفعيل (Admin, Reconciler)
 * GET  /partners/{id}/accounts         — حسابات الطرف (الجميع)
 * POST /partners/{id}/accounts         — حساب بعملة (Admin, Reconciler) — فريد (مورد×عملة)
 */
export function partnersRoutes(svc: PartnerService): Router {
  const router = Router();
  const canWrite = requireRole('admin', 'reconciler');

  router.get('/', requireAuth, async (_req: Request, res: Response) => {
    res.json({ partners: await svc.listPartners() });
  });

  router.post('/', requireAuth, canWrite, async (req: Request, res: Response) => {
    const input = createPartnerSchema.parse(req.body);
    const partner = await svc.createPartner(req.user!.id, input, clientIp(req));
    res.status(201).json({ partner });
  });

  router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    res.json({ partner: await svc.getPartner(parseId(req)) });
  });

  router.put('/:id', requireAuth, canWrite, async (req: Request, res: Response) => {
    const input = updatePartnerSchema.parse(req.body);
    const partner = await svc.updatePartner(req.user!.id, parseId(req), input, clientIp(req));
    res.json({ partner });
  });

  router.get('/:id/accounts', requireAuth, async (req: Request, res: Response) => {
    res.json({ accounts: await svc.listAccounts(parseId(req)) });
  });

  router.post('/:id/accounts', requireAuth, canWrite, async (req: Request, res: Response) => {
    const input = createAccountSchema.parse(req.body);
    const account = await svc.createAccount(req.user!.id, parseId(req), input, clientIp(req));
    res.status(201).json({ account });
  });

  return router;
}
