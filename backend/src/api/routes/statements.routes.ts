import { Router } from 'express';
import multer from 'multer';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { StatementService } from '../../application/statement.service.js';
import type { MatchingService } from '../../application/matching.service.js';
import type { OcrService } from '../../application/ocr.service.js';
import { requireAuth, requireRole } from '../middleware/session.js';
import { parseId, clientIp } from './shared.js';

/**
 * مسارات الكشوفات (Module 3):
 * POST /statements/upload                      multipart → معاينة (لا قاعدة بعد)
 * PUT  /statements/preview/{token}/lines/{no}  تصحيح بند في المعاينة
 * POST /statements/preview/{token}/commit      اعتماد نهائي = كتابة معاملة واحدة
 * POST /statements/manual                      إدخال يدوي/OCR بعد التدقيق
 * POST /statements/ocr                          استخراج بنود PDF محلياً (طبقة نصية أو OCR) — مسودة للمراجعة
 * GET  /statements/{id}                        تفصيل كشف ببنوده (الجميع)
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB — كشوف الملفات المحلية لا تحتاج أكثر
});

const uploadFields = z.object({
  accountId: z.coerce.number().int().positive(),
  side: z.enum(['ours', 'theirs']),
  templateId: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? null : Number(v)),
    z.number().int().positive().nullable(),
  ),
});

const commitSchema = z.object({
  openingBalance: z.coerce.number().optional().nullable(),
  announcedClosing: z.coerce.number().optional().nullable(),
  announcedCount: z.coerce.number().int().optional().nullable(),
  sessionId: z.preprocess((v) => (v === '' || v === undefined || v === null ? null : Number(v)), z.number().int().positive().nullable()),
});

const manualSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  side: z.enum(['ours', 'theirs']),
  openingBalance: z.coerce.number().optional().nullable(),
  lines: z
    .array(
      z.object({
        entryDate: z.string().trim().min(6, 'أدخل تاريخ البند'),
        description: z.string().trim().min(1, 'أدخل البيان'),
        ref: z.string().trim().max(40).optional(),
        debit: z.coerce.number().nonnegative().optional().nullable(),
        credit: z.coerce.number().nonnegative().optional().nullable(),
        ocrConfidence: z.coerce.number().min(0).max(1).optional().nullable(),
      }),
    )
    .min(1, 'أدخل بنداً واحداً على الأقل'),
});

const linePatchSchema = z
  .object({
    dateRaw: z.string().max(30).optional(),
    description: z.string().max(300).optional(),
    debitRaw: z.string().max(30).optional(),
    creditRaw: z.string().max(30).optional(),
    ref: z.string().max(40).optional(),
    docType: z.string().max(60).optional(),
    docNo: z.string().max(40).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'لا تعديلات في الطلب' });

export function statementsRoutes(svc: StatementService, matchingSvc: MatchingService, ocrSvc: OcrService): Router {
  const router = Router();
  const canWrite = requireRole('admin', 'reconciler');

  router.post('/upload', requireAuth, canWrite, upload.single('file'), async (req, res: Response) => {
    const { file } = req as Request & { file?: Express.Multer.File };
    if (!file) {
      res.status(422).json({ error: { code: 'VALIDATION_FAILED', messageAr: 'أرفق ملف الكشف في الحقل file' } });
      return;
    }
    const fields = uploadFields.parse(req.body);
    const preview = await svc.upload(req.user!.id, file, fields);
    res.status(201).json(preview);
  });

  router.put('/preview/:token/lines/:lineNo', requireAuth, canWrite, async (req: Request, res: Response) => {
    const patch = linePatchSchema.parse(req.body);
    const line = svc.updateLine(String(req.params.token), Number(req.params.lineNo), patch);
    res.json({ line });
  });

  router.post('/preview/:token/commit', requireAuth, canWrite, async (req: Request, res: Response) => {
    const body = commitSchema.parse(req.body ?? {});
    const result = await svc.commit(req.user!.id, String(req.params.token), body, clientIp(req));

    // اكتمل الكشفان؟ المحرك يبحث ويطابق فوراً — القواعد القطعية تؤكد نفسها (وضع auto)
    if (result.bothAttached && result.sessionId) {
      try {
        await matchingSvc.suggest(req.user!.id, result.sessionId, clientIp(req), 'auto');
      } catch {
        /* فشل الاقتراح لا يبطل اعتماداً تمَّ */
      }
    }
    res.status(201).json(result);
  });

  // === استيراد PDF/صورة (Module 11): استخراج محلي بالكامل — مسودة مراجعة إلزامية قبل الاعتماد ===
  router.post('/ocr', requireAuth, canWrite, upload.single('file'), async (req: Request, res: Response) => {
    const { file } = req as Request & { file?: Express.Multer.File };
    if (!file) {
      res.status(422).json({ error: { code: 'VALIDATION_FAILED', messageAr: 'أرفق ملف الكشف في الحقل file' } });
      return;
    }
    const ext = (file.originalname.toLowerCase().split('.').pop() ?? '');
    // PDF أو صورة (PNG/JPG) — كلاهما يُعالَج محلياً للمراجعة (M11)
    if (ext === 'pdf') {
      const draft = await ocrSvc.extractPdf(file.buffer);
      res.status(201).json({ draft });
      return;
    }
    if (['png', 'jpg', 'jpeg'].includes(ext)) {
      const draft = await ocrSvc.extractImage(file.buffer);
      res.status(201).json({ draft });
      return;
    }
    res.status(422).json({
      error: { code: 'VALIDATION_FAILED', messageAr: 'هذا المسار لكشوف PDF أو الصور (PNG/JPG) فقط — لملفات Excel/CSV استخدم نافذة الرفع العادية' },
    });
  });

  router.post('/manual', requireAuth, canWrite, async (req: Request, res: Response) => {
    const input = manualSchema.parse(req.body);
    const result = await svc.manual(req.user!.id, input, clientIp(req));
    res.status(201).json(result);
  });

  router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    const { statement, lines } = await svc.getById(parseId(req));
    res.json({ statement, lines });
  });

  return router;
}
