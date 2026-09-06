import type { CurrencyCode } from '@/shared/types';

/** تسميات مشتركة لنطاق الشركاء (كانت في partnersMock — الملف حُذف مع ربط الخادم) */

/** أسماء القواعد بالعربية — مستخدمة في بطاقات الحسابات */
export const RULE_LABELS: Record<string, string> = {
  exact_ref: 'مرجع تام',
  ref_map: 'خريطة المراجع',
  description_ref: 'مرجع من البيان',
  amount_date: 'مبلغ + تاريخ',
};

export const ADJUSTMENT_TYPE_LABELS: Record<string, string> = {
  discount: 'خصم',
  return: 'مرتجع',
  other: 'أخرى',
};

/** العملات المدعومة (D4) — لاختيار عملة حساب جديد */
export const SUPPORTED_CURRENCIES: CurrencyCode[] = ['YER', 'USD', 'SAR'];
