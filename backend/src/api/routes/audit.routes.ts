import { Router } from 'express';
import type { Request, Response } from 'express';
import { AuditRepository } from '../../infrastructure/repositories/audit.repository.js';
import { listAuditSchema } from '../../application/auth.dto.js';
import { requireAuth, requireRole } from '../middleware/session.js';

/** سجل التدقيق — Admin فقط + قراءة فقط (FR-7.2) */
export function auditRoutes(auditRepo: AuditRepository): Router {
  const router = Router();

  router.get('/', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    const filters = listAuditSchema.parse(req.query);
    const result = await auditRepo.list(filters);
    res.json({
      total: result.total,
      items: result.items.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        before: r.before,
        after: r.after,
        ip: r.ip,
        createdAt: r.created_at,
        actor: r.actor_username ? { username: r.actor_username, fullName: r.actor_name } : null,
      })),
    });
  });

  return router;
}
