import { z } from 'zod';

/**
 * مخططات تحقق المدخلات (zod) — كل نقطة نهاية تتحقق قبل أي منطق (القاعدة 3 من الأمر).
 * الرسائل عربية مباشرة لأنها تصل المستخدم كما هي.
 */

export const loginSchema = z.object({
  username: z.preprocess((v) => (v == null ? '' : v), z.string().trim().min(1, 'أدخل اسم المستخدم').max(30)),
  password: z.preprocess((v) => (v == null ? '' : v), z.string().min(1, 'أدخل كلمة المرور').max(100)),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'أدخل كلمة المرور الحالية').max(100),
    newPassword: z
      .string()
      .min(8, 'كلمة المرور الجديدة 8 أحرف على الأقل')
      .max(100)
      .regex(/[A-Za-z]/, 'يجب أن تحتوي على حرف واحد على الأقل')
      .regex(/\d/, 'يجب أن تحتوي على رقم واحد على الأقل'),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const createUserSchema = z.object({
  fullName: z.string().trim().min(2, 'أدخل الاسم الكامل').max(60),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]+$/, 'اسم المستخدم: أحرف إنجليزية وأرقام و . _ - فقط')
    .min(3, 'اسم المستخدم قصير جداً')
    .max(30),
  role: z.enum(['admin', 'reconciler', 'viewer']),
  initialPassword: z.string().min(8, '8 أحرف على الأقل').max(100),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const setActiveSchema = z.object({ isActive: z.boolean() });
export const listAuditSchema = z.object({
  actorId: z.coerce.number().int().positive().optional(),
  action: z.string().trim().max(40).optional(),
  search: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** تحويل أخطاء zod إلى تفاصيل موحدة للواجهة */
export function zodDetails(err: z.ZodError): Array<{ field: string; messageAr: string }> {
  return err.issues.map((i) => ({
    field: i.path.join('.') || '_',
    messageAr: i.message,
  }));
}
