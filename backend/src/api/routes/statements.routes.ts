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
 * POST /statements/manual                      إدخال يدوي بلا ملف
 * POST /statements/ocr                          استخراج PDF/صورة وحفظ معاينة مرتبطة بالأصل
 * GET  /statements/{id}                        تفصيل كشف ببنوده (الجميع)
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB — كشوف الملفات المحلية لا تحتاج أكثر
});

/** حقول JSON داخل multipart تصل كنص — تُفكّ هنا قبل التحقق */
const jsonField = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const text = value.trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return value;
    }
  }, schema);

const mappingSchema = z
  .record(z.string(), z.string().regex(/^[A-Za-z]{1,2}$/, 'حرف عمود غير صالح'))
  .refine((mapping) => Object.keys(mapping).length > 0, 'حدّد عموداً واحداً على الأقل');

const uploadFields = z.object({
  accountId: z.coerce.number().int().positive(),
  side: z.enum(['ours', 'theirs']),
  templateId: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? null : Number(v)),
    z.number().int().positive().nullable(),
  ),
  mapping: jsonField(mappingSchema.nullable().optional()),
  headerRows: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? null : Number(v)),
    z.number().int().min(0).max(15).nullable().optional(),
  ),
  decimalSep: z.enum(['.', ',']).optional(),
  thousandSep: z.enum(['.', ',']).optional(),
  dateFormat: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY', 'YYYY/MM/DD']).optional(),
  sheetName: z.string().trim().min(1).max(120).optional(),
  saveTemplate: jsonField(
    z
      .object({
        name: z.string().trim().min(1, 'أدخل اسم القالب').max(80),
        isDefault: z.boolean().default(false),
      })
      .nullable()
      .optional(),
  ),
});

const ocrFields = uploadFields.pick({ accountId: true, side: true });

const commitSchema = z.object({
  openingBalance: z.coerce.number().optional().nullable(),
  announcedClosing: z.coerce.number().optional().nullable(),
  announcedCount: z.coerce.number().int().optional().nullable(),
  sessionId: z.preprocess((v) => (v === '' || v === undefined || v === null ? null : Number(v)), z.number().int().positive().nullable()),
});

const manualSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  side: z.enum(['ours', 'theirs']),
  sessionId: z.coerce.number().int().positive().optional().nullable(),
  openingBalance: z.coerce.number().optional().nullable(),
  lines: z
    .array(
      z.object({
        entryDate: z.string().trim().min(6, 'أدخل تاريخ البند'),
        description: z.string().trim().min(1, 'أدخل البيان'),
        ref: z.string().trim().max(40).optional(),
        debit: z.coerce.number().nonnegative().optional().nullable(),
        credit: z.coerce.number().nonnegative().optional().nullable(),
      }).strict(),
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
  let ocrInProgress = false;

  const suggestAfterCommit = async (req: Request, result: { bothAttached?: boolean; sessionId?: number }) => {
    if (result.bothAttached && result.sessionId) {
      try {
        await matchingSvc.suggest(req.user!.id, result.sessionId, clientIp(req), 'auto');
      } catch {
        return;
      }
    }
  };

  // === فحص الملف (2026-11-27): تعرّف على الأعمدة واقتراح تعيينها — لا كتابة في القاعدة ===
  router.post('/inspect', requireAuth, canWrite, upload.single('file'), async (req: Request, res: Response) => {
    const { file } = req as Request & { file?: Express.Multer.File };
    if (!file) {
      res.status(422).json({ error: { code: 'VALIDATION_FAILED', messageAr: 'أرفق ملف الكشف في الحقل file' } });
      return;
    }
    const { sheetName } = z
      .object({ sheetName: z.string().trim().min(1).max(120).optional() })
      .parse(req.body ?? {});
    res.status(201).json({ inspection: await svc.inspect(file, sheetName) });
  });

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
    const line = svc.updateLine(req.user!.id, String(req.params.token), Number(req.params.lineNo), patch);
    res.json({ line });
  });

  router.post('/preview/:token/commit', requireAuth, canWrite, async (req: Request, res: Response) => {
    const body = commitSchema.parse(req.body ?? {});
    const result = await svc.commit(req.user!.id, String(req.params.token), body, clientIp(req));

    await suggestAfterCommit(req, result);
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
    if (!['pdf', 'png', 'jpg', 'jpeg'].includes(ext)) {
      res.status(422).json({
        error: { code: 'VALIDATION_FAILED', messageAr: 'هذا المسار لكشوف PDF أو الصور (PNG/JPG) فقط — لملفات Excel/CSV استخدم نافذة الرفع العادية' },
      });
      return;
    }
    const fields = ocrFields.parse(req.body);
    if (ocrInProgress) {
      res.status(429).json({ error: { code: 'OCR_BUSY', messageAr: 'قراءة ملف آخر جارية — أعد المحاولة بعد اكتمالها' } });
      return;
    }
    ocrInProgress = true;
    try {
      const draft = ext === 'pdf'
        ? await ocrSvc.extractPdf(file.buffer)
        : await ocrSvc.extractImage(file.buffer, ext === 'png' ? 'png' : 'jpeg');
      const token = await svc.uploadOcr(req.user!.id, file, fields, draft);
      res.status(201).json({ draft, token });
    } finally {
      ocrInProgress = false;
    }
  });

  router.post('/manual', requireAuth, canWrite, async (req: Request, res: Response) => {
    const input = manualSchema.parse(req.body);
    const result = await svc.manual(req.user!.id, input, clientIp(req));
    await suggestAfterCommit(req, result);
    res.status(201).json(result);
  });

  router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    const { statement, lines } = await svc.getById(parseId(req));
    res.json({ statement, lines });
  });

  return router;
}
