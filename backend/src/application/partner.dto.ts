import { z } from 'zod';
import { MATCH_RULES } from '../domain/partner.js';

/** مخططات تحقق نطاق الشركاء — كل نقطة تتحقق قبل أي منطق (قاعدة الأمر 3) */

const nameAr = z.string().trim().min(2, 'أدخل اسم المورد بالعربية').max(120);
const optText = (max: number) => z.string().trim().max(max).optional().nullable();

export const createPartnerSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,20}$/, 'الرمز: أحرف إنجليزية وأرقام وشرطات فقط (3–20)')
    .optional(), // الهجين: يُولَّد SUP-nn تلقائياً عند الغياب
  nameAr,
  nameEn: optText(120),
  phone: optText(30),
  email: z.string().trim().email('بريد غير صالح').max(80).optional().nullable().or(z.literal('')),
  notes: optText(500),
});
export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;

export const updatePartnerSchema = z.object({
  nameAr: nameAr.optional(),
  nameEn: optText(120),
  phone: optText(30),
  email: z.string().trim().email('بريد غير صالح').max(80).optional().nullable().or(z.literal('')),
  notes: optText(500),
  isActive: z.boolean().optional(),
});
export type UpdatePartnerInput = z.infer<typeof updatePartnerSchema>;

export const createAccountSchema = z.object({
  currencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'رمز العملة ثلاثة أحرف (YER / USD / SAR)'),
  ourLedgerCode: z.string().trim().max(30).optional().nullable(),
  dateWindowDays: z.coerce.number().int().min(0, '0 على الأقل').max(30, '30 كحد أقصى').optional(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

/** ترتيب القواعد: القواعد الأربع كلها، بلا تكرار — لأن المحرك يطبقها بالترتيب حرفياً */
export const matchingSettingsSchema = z
  .object({
    dateWindowDays: z.coerce.number().int().min(0).max(30).optional(),
    ruleOrder: z.array(z.enum(MATCH_RULES)).optional(),
  })
  .refine(
    (v) =>
      v.ruleOrder === undefined ||
      (new Set(v.ruleOrder).size === MATCH_RULES.length &&
        v.ruleOrder.every((r) => MATCH_RULES.includes(r))),
    { message: 'ترتيب القواعد يجب أن يحوي القواعد الأربع كلها دون تكرار' },
  );
export type MatchingSettingsInput = z.infer<typeof matchingSettingsSchema>;

export const refMapCreateSchema = z.object({
  ourRef: z.string().trim().min(1, 'أدخل مرجعنا').max(40),
  theirRef: z.string().trim().min(1, 'أدخل مرجعهم').max(40),
});

export const adjustmentCreateSchema = z.object({
  adjustmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ بصيغة YYYY-MM-DD'),
  adjustmentType: z.enum(['discount', 'return', 'other']),
  amount: z.coerce.number().positive('المبلغ يجب أن يكون موجباً').max(1e15),
  currencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'رمز العملة ثلاثة أحرف'),
  note: optText(300),
});
export type AdjustmentCreateInput = z.infer<typeof adjustmentCreateSchema>;

export const templateCreateSchema = z.object({
  templateKind: z.enum(['ours', 'theirs']).default('theirs'),
  name: z.string().trim().min(1, 'أدخل اسم القالب').max(80),
  headerRows: z.coerce.number().int().min(0).max(10).default(1),
  columnsMapping: z
    .record(z.string(), z.string())
    .refine((m) => Object.keys(m).length >= 1, 'حدّد تعيين عمود واحد على الأقل'),
  dateFormats: z.array(z.string().trim().min(1)).min(1).default(['YYYY-MM-DD', 'DD/MM/YYYY']),
  decimalSep: z.string().max(1).default('.'),
  thousandSep: z.string().max(1).default(','),
  isDefault: z.boolean().default(false),
});
export type TemplateCreateInput = z.infer<typeof templateCreateSchema>;
