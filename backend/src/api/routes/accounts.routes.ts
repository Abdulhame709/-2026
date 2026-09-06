import { Router } from 'express';
import type { Request, Response } from 'express';
import type { PartnerService } from '../../application/partner.service.js';
import {
  matchingSettingsSchema,
  refMapCreateSchema,
  adjustmentCreateSchema,
  templateCreateSchema,
} from '../../application/partner.dto.js';
import { requireAuth, requireRole } from '../middleware/session.js';
import { parseId, clientIp } from './shared.js';
import { ERR } from '../../domain/errors.js';

/**
 * مسارات مستوى الحساب (Module 2) — الكتابة: Admin+Reconciler، القراءة: الجميع:
 * PUT    /accounts/{id}/matching-settings        نافذة التاريخ + ترتيب القواعد
 * GET/POST/DELETE /accounts/{id}/ref-map[/{eid}] خريطة المراجع
 * GET/POST /accounts/{id}/notified-adjustments   التسويات المبلَّغة
 * GET/POST /accounts/{id}/import-templates       قوالب كشوفهم (+ كشوفنا المشترك في القائمة)
 * POST   /import-templates/ours                  قالب كشوفنا (ONYX PRO) المشترك
 */
export function accountsRoutes(svc: PartnerService): Router {
  const router = Router();
  const canWrite = requireRole('admin', 'reconciler');

  router.put('/:id/matching-settings', requireAuth, canWrite, async (req: Request, res: Response) => {
    const input = matchingSettingsSchema.parse(req.body);
    const account = await svc.updateMatchingSettings(req.user!.id, parseId(req), input, clientIp(req));
    res.json({ account });
  });

  router.get('/:id/ref-map', requireAuth, async (req: Request, res: Response) => {
    res.json({ entries: await svc.listRefMap(parseId(req)) });
  });

  router.post('/:id/ref-map', requireAuth, canWrite, async (req: Request, res: Response) => {
    const input = refMapCreateSchema.parse(req.body);
    const entry = await svc.addRefMap(req.user!.id, parseId(req), input, clientIp(req));
    res.status(201).json({ entry });
  });

  router.delete('/:id/ref-map/:entryId', requireAuth, canWrite, async (req: Request, res: Response) => {
    const entryId = Number(req.params.entryId);
    if (!Number.isInteger(entryId) || entryId <= 0) throw ERR.NOT_FOUND();
    await svc.deleteRefMap(req.user!.id, parseId(req), entryId, clientIp(req));
    res.status(204).end();
  });

  router.get('/:id/notified-adjustments', requireAuth, async (req: Request, res: Response) => {
    res.json({ adjustments: await svc.listAdjustments(parseId(req)) });
  });

  router.post('/:id/notified-adjustments', requireAuth, canWrite, async (req: Request, res: Response) => {
    const input = adjustmentCreateSchema.parse(req.body);
    const entry = await svc.createAdjustment(req.user!.id, parseId(req), input, clientIp(req));
    res.status(201).json({ adjustment: entry });
  });

  router.get('/:id/import-templates', requireAuth, async (req: Request, res: Response) => {
    res.json({ templates: await svc.listTemplates(parseId(req)) });
  });

  router.post('/:id/import-templates', requireAuth, canWrite, async (req: Request, res: Response) => {
    const input = templateCreateSchema.parse(req.body);
    const template = await svc.createTemplate(req.user!.id, parseId(req), input, clientIp(req));
    res.status(201).json({ template });
  });

  return router;
}

/** قالب كشوفنا المشترك (account_id = NULL): POST /import-templates/ours */
export function templatesRoutes(svc: PartnerService): Router {
  const router = Router();

  router.post('/ours', requireAuth, requireRole('admin', 'reconciler'), async (req: Request, res: Response) => {
    const input = templateCreateSchema.parse({ ...req.body, templateKind: 'ours' });
    const template = await svc.createTemplate(req.user!.id, null, input, clientIp(req));
    res.status(201).json({ template });
  });

  return router;
}
