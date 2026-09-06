import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../domain/errors.js';
import { zodDetails } from '../../application/auth.dto.js';
import { ZodError } from 'zod';
import multer from 'multer';

/**
 * معالجة الأخطاء الموحدة — كل خطأ يخرج بالشكل:
 * { error: { code, messageAr, traceId?, details? } }
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const traceId = randomUUID().slice(0, 8);

  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        messageAr: 'المدخلات غير صالحة',
        details: zodDetails(err),
        traceId,
      },
    });
    return;
  }

  // أخطاء رفع الملفات (multer) — رسائل عربية واضحة بدل 500
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'الملف أكبر من الحد المسموح — صغّر الملف ثم أعد المحاولة'
        : err.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'حقل الملف غير متوقع — أعد المحاولة من داخل الشاشة مباشرة'
          : 'تعذر استلام الملف — أعد المحاولة';
    res.status(422).json({ error: { code: 'VALIDATION_FAILED', messageAr: msg, traceId } });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.httpStatus).json({
      error: {
        code: err.code,
        messageAr: err.messageAr,
        ...(err.details !== undefined ? { details: err.details } : {}),
        traceId,
      },
    });
    return;
  }

  // خطأ غير متوقع — السجل كامل في الخادم فقط، والعميل يحصل على رسالة عامة
  console.error(`[traceId=${traceId}]`, err);
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      messageAr: 'حدث خطأ غير متوقع — أعد المحاولة',
      traceId,
    },
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', messageAr: 'المسار غير موجود — راجع مواصفة /api/v1' },
  });
}
