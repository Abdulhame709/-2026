import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * خطأ تطبيقي موحد — يترجم دائماً إلى { error: { code, messageAr, traceId? } } (مواصفة API §4.1).
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    public readonly messageAr: string,
    public readonly details?: unknown,
  ) {
    super(messageAr);
    this.name = 'AppError';
  }
}

export const ERR = {
  INVALID_CREDENTIALS: () => new AppError('INVALID_CREDENTIALS', 401, 'اسم المستخدم أو كلمة المرور غير صحيحة'),
  ACCOUNT_LOCKED: (seconds: number) =>
    new AppError('ACCOUNT_LOCKED', 401, `حُظر مؤقتاً — حاول بعد ${seconds} ثانية`, { retryAfterSeconds: seconds }),
  ACCOUNT_DISABLED: () => new AppError('ACCOUNT_DISABLED', 403, 'حسابك معطل — راجع مدير النظام'),
  UNAUTHENTICATED: () => new AppError('UNAUTHENTICATED', 401, 'غير مسجل الدخول'),
  FORBIDDEN: () => new AppError('FORBIDDEN', 403, 'لا تملك صلاحية لهذا الإجراء'),
  NOT_FOUND: () => new AppError('NOT_FOUND', 404, 'العنصر غير موجود'),
  VALIDATION: (details: unknown) => new AppError('VALIDATION_FAILED', 422, 'المدخلات غير صالحة', details),
  USERNAME_TAKEN: () => new AppError('USERNAME_TAKEN', 409, 'اسم المستخدم مستخدم مسبقاً'),
  WRONG_PASSWORD: () => new AppError('WRONG_PASSWORD', 422, 'كلمة المرور الحالية غير صحيحة'),
  PARTNER_CODE_TAKEN: () => new AppError('PARTNER_CODE_TAKEN', 409, 'رمز المورد مستخدم مسبقاً'),
  PARTNER_NOT_FOUND: () => new AppError('PARTNER_NOT_FOUND', 404, 'المورد غير موجود'),
  ACCOUNT_EXISTS: () => new AppError('ACCOUNT_EXISTS', 409, 'هذا المورد لديه حساب بنفس العملة مسبقاً'),
  CURRENCY_NOT_FOUND: () => new AppError('CURRENCY_NOT_FOUND', 422, 'العملة غير معروفة — العملات المدعومة YER وUSD وSAR'),
  BAD_RULE_ORDER: () => new AppError('BAD_RULE_ORDER', 422, 'ترتيب القواعد غير صالح — يجب أن يحوي القواعد الأربع كلها دون تكرار'),
  PREVIEW_EXPIRED: () => new AppError('PREVIEW_EXPIRED', 410, 'انتهت صلاحية المعاينة — أعد رفع الملف'),
  SESSION_EXISTS: (id: number) => new AppError('SESSION_EXISTS', 409, `توجد جلسة مفتوحة لنفس الحساب والفترة (#${id}) — أكملها أو أغلقها أولاً`),
} as const;

/** تغليف المعالجات غير المتزامنة (احتياطاً رغم أن Express 5 يعيد توجيهها) */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
