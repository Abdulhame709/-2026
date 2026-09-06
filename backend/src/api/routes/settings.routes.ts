import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { z } from 'zod';
import type { BackupService } from '../../application/backup.service.js';
import type { SettingsRepository } from '../../infrastructure/repositories/settings.repository.js';
import type { AuditRepository } from '../../infrastructure/repositories/audit.repository.js';
import { requireAuth, requireRole } from '../middleware/session.js';
import { clientIp } from './shared.js';

/**
 * مسارات الإدارة (Module 6):
 * GET/PUT /settings/company   بيانات الشركة لترويسة التقارير (كتابة أدمن)
 * POST /settings/company/logo    رفع الشعار محلياً (أدمن — PNG/JPG/SVG حتى 300KB)
 * GET  /settings/company/logo    عرض الشعار (الجميع — قناة الجلسة نفسها) لترويسة التقرير
 * DELETE /settings/company/logo  إزالة الشعار (أدمن)
 * GET/POST /reason-codes (+PATCH/:id +POST/reorder) — إدارة الأسباب (أدمن)
 * GET/POST /backups           نسخ أعمال JSON محلية (أدمن)
 * GET  /backups/{name}/download
 * POST /backups/{name}/restore  أخطر عملية — أدمن + حافز في الواجهة
 * DELETE /backups/{name}
 */

/**
 * تحديث جزئي بدمج خادمي: أي حقل لا يُرسل يبقى كما هو — كي لا يفشل حفظُ
 * جزءٍ (كترتيب العملات أو الشعار) لِخلوّ حقولٍ أخرى لم يملأها المستخدم بعد.
 * اسم الشركة يُقبل فارغاً — التقارير تتحول للاسم الافتراضي «شركة المؤسسة».
 */
const companySchema = z
  .object({
    nameAr: z.string().trim().max(120),
    nameEn: z.string().trim().max(120),
    address: z.string().trim().max(200),
    phone: z.string().trim().max(40),
    email: z.string().trim().max(120),
    reportHeaderNote: z.string().trim().max(300),
    logoFileName: z.string().trim().max(120).nullable(),
    currencyOrder: z.array(z.enum(['YER', 'USD', 'SAR'])),
  })
  .partial();

const reasonAddSchema = z.object({
  nameAr: z.string().trim().min(2, 'الاسم العربي إلزامي').max(120),
  nameEn: z.string().trim().min(2, 'الاسم الإنجليزي إلزامي (يُشتق منه الرمز)').max(120),
});

const reasonPatchSchema = z.object({
  isActive: z.boolean().optional(),
  nameAr: z.string().trim().max(120).optional(),
  nameEn: z.string().trim().max(120).optional(),
});

const reorderSchema = z.object({ ids: z.array(z.coerce.number().int().positive()).min(1) });

export function settingsRoutes(
  settingsRepo: SettingsRepository,
  auditRepo: AuditRepository,
): Router {
  const router = Router();
  const admin = requireRole('admin');

  router.get('/company', requireAuth, async (_req: Request, res: Response) => {
    res.json({ company: await settingsRepo.getCompany() });
  });

  router.put('/company', requireAuth, admin, async (req: Request, res: Response) => {
    const patch = companySchema.parse(req.body);
    const current = await settingsRepo.getCompany();
    const saved = await settingsRepo.saveCompany({ ...current, ...patch }, req.user!.id);
    await auditRepo.write({
      actorId: req.user!.id,
      action: 'COMPANY_SETTINGS_UPDATE',
      entityType: 'settings',
      entityId: 'company',
      after: { nameAr: saved.nameAr },
      ip: clientIp(req),
    });
    res.json({ company: saved });
  });

  // ===== شعار الشركة (Module 9) — ملف محلي في storage/uploads بلا أي خدمة خارجية =====
  const LOGO_DIR = path.resolve('storage/uploads');
  const LOGO_TYPES: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/svg+xml': '.svg',
  };
  const logoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 300 * 1024 }, // 300KB كافٍ لشعار ترويسة حاد الطباعة
  });

  router.post('/company/logo', requireAuth, admin, logoUpload.single('file'), async (req: Request, res: Response) => {
    const { file } = req as Request & { file?: Express.Multer.File };
    if (!file) {
      res.status(422).json({ error: { code: 'VALIDATION_FAILED', messageAr: 'أرفق ملف الشعار في الحقل file' } });
      return;
    }
    const ext = LOGO_TYPES[file.mimetype];
    if (!ext) {
      res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          messageAr: 'صيغة الشعار غير مدعومة — المسموح PNG أو JPG أو SVG (يفضَّل PNG بخلفية شفافة)',
        },
      });
      return;
    }
    // SVG يُفحص سطحه لعدم احتوائه سكربتات (يُعرض داخل صفحات التطبيق)
    if (ext === '.svg' && /<script|onload\s*=/i.test(file.buffer.toString('utf8'))) {
      res.status(422).json({ error: { code: 'VALIDATION_FAILED', messageAr: 'ملف SVG يحتوي سكربتاً — أرسل شعاراً نظيفاً بلا أكواد' } });
      return;
    }
    const company = await settingsRepo.getCompany();
    const storedName = `logo-${Date.now()}${ext}`;
    await writeFile(path.join(LOGO_DIR, storedName), file.buffer);
    // الشعار القديم يُحذف كي لا تتراكم الملفات
    if (company.logoFileName) await unlink(path.join(LOGO_DIR, company.logoFileName)).catch(() => undefined);
    const saved = await settingsRepo.saveCompany({ ...company, logoFileName: storedName }, req.user!.id);
    await auditRepo.write({
      actorId: req.user!.id,
      action: 'COMPANY_LOGO_UPDATE',
      entityType: 'settings',
      entityId: 'company',
      after: { logoFileName: storedName, sizeBytes: file.size },
      ip: clientIp(req),
    });
    res.json({ company: saved });
  });

  router.get('/company/logo', requireAuth, async (_req: Request, res: Response) => {
    const company = await settingsRepo.getCompany();
    if (!company.logoFileName) {
      res.status(404).json({ error: { code: 'NOT_FOUND', messageAr: 'لا شعار مرفوعاً بعد' } });
      return;
    }
    try {
      const buf = await readFile(path.join(LOGO_DIR, company.logoFileName));
      const type = Object.entries(LOGO_TYPES).find(([, e]) => company.logoFileName!.endsWith(e))?.[0] ?? 'image/png';
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'no-store');
      res.send(buf);
    } catch {
      res.status(404).json({ error: { code: 'NOT_FOUND', messageAr: 'ملف الشعار مفقود — أعد رفعه' } });
    }
  });

  router.delete('/company/logo', requireAuth, admin, async (req: Request, res: Response) => {
    const company = await settingsRepo.getCompany();
    if (company.logoFileName) {
      await unlink(path.join(LOGO_DIR, company.logoFileName)).catch(() => undefined);
      const saved = await settingsRepo.saveCompany({ ...company, logoFileName: null }, req.user!.id);
      await auditRepo.write({
        actorId: req.user!.id,
        action: 'COMPANY_LOGO_DELETE',
        entityType: 'settings',
        entityId: 'company',
        ip: clientIp(req),
      });
      res.json({ company: saved });
      return;
    }
    res.json({ company });
  });

  return router;
}

export function reasonAdminRoutes(settingsRepo: SettingsRepository, auditRepo: AuditRepository): Router {
  const router = Router();
  const admin = requireRole('admin');

  router.post('/', requireAuth, admin, async (req: Request, res: Response) => {
    const input = reasonAddSchema.parse(req.body);
    const created = await settingsRepo.addReasonCode(input);
    await auditRepo.write({
      actorId: req.user!.id,
      action: 'REASON_CODE_CREATE',
      entityType: 'reason_code',
      entityId: String(created.id),
      after: { code: created.code },
      ip: clientIp(req),
    });
    res.status(201).json({ reason: created });
  });

  router.post('/reorder', requireAuth, admin, async (req: Request, res: Response) => {
    const { ids } = reorderSchema.parse(req.body);
    await settingsRepo.reorderReasonCodes(ids);
    await auditRepo.write({
      actorId: req.user!.id,
      action: 'REASON_CODE_REORDER',
      entityType: 'reason_codes',
      entityId: '*',
      after: { order: ids },
      ip: clientIp(req),
    });
    res.json({ ok: true });
  });

  router.patch('/:id', requireAuth, admin, async (req: Request, res: Response) => {
    const patch = reasonPatchSchema.parse(req.body);
    const ok = await settingsRepo.updateReasonCode(Number(req.params.id), patch);
    if (!ok) {
      res.status(404).json({ error: { code: 'NOT_FOUND', messageAr: 'السبب غير موجود' } });
      return;
    }
    await auditRepo.write({
      actorId: req.user!.id,
      action: 'REASON_CODE_UPDATE',
      entityType: 'reason_code',
      entityId: String(req.params.id),
      after: patch,
      ip: clientIp(req),
    });
    res.json({ ok: true });
  });

  return router;
}

const BACKUP_NAME = z
  .string()
  .regex(/^backup-[A-Za-z0-9._-]+\.json$/, 'اسم ملف غير صالح');

export function backupsRoutes(backupSvc: BackupService): Router {
  const router = Router();
  const admin = requireRole('admin');

  router.get('/', requireAuth, admin, async (_req: Request, res: Response) => {
    res.json({ backups: await backupSvc.list() });
  });

  router.post('/', requireAuth, admin, async (req: Request, res: Response) => {
    const info = await backupSvc.create(req.user!, clientIp(req));
    res.status(201).json({ backup: info });
  });

  router.get('/:name/download', requireAuth, admin, async (req: Request, res: Response) => {
    const name = BACKUP_NAME.parse(req.params.name);
    const full = await backupSvc.filePath(name);
    res.download(full, name);
  });

  router.post('/:name/restore', requireAuth, admin, async (req: Request, res: Response) => {
    const name = BACKUP_NAME.parse(req.params.name);
    const result = await backupSvc.restore(name, req.user!, clientIp(req));
    res.json({ restored: name, counts: result.counts });
  });

  router.delete('/:name', requireAuth, admin, async (req: Request, res: Response) => {
    const name = BACKUP_NAME.parse(req.params.name);
    await backupSvc.deleteBackup(name, req.user!, clientIp(req));
    res.status(204).end();
  });

  return router;
}
