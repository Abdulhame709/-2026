/**
 * الأنواع المشتركة للنظام — متطابقة مع مخطط البيانات والـ API (Stage 2 §2/§4).
 * عند ربط الخادم تُستبدل بأنواع مولّدة من OpenAPI.
 */

export type CurrencyCode = 'YER' | 'USD' | 'SAR';

export type SessionStatus = 'in_progress' | 'closed' | 'reopened';

export type DiscrepancyStatus = 'new' | 'in_progress' | 'resolved' | 'accepted';

export type DiscrepancyType =
  | 'amount_diff'
  | 'date_diff'
  | 'ref_diff'
  | 'ours_only'
  | 'theirs_only';

/** صف في "جلسات تحتاج انتباهاً" (لوحة المؤشرات) */
export interface SessionAttentionRow {
  id: number;
  partnerName: string;
  currency: CurrencyCode;
  periodLabel: string;
  status: SessionStatus;
  openDiscrepancies: number;
  openDiscrepancyValue: number;
  lastActivityLabel: string;
}

/** صف في "الفروق المتجاوزة 30 يوماً" */
export interface OldDiscrepancyRow {
  id: number;
  partnerName: string;
  currency: CurrencyCode;
  periodLabel: string;
  summary: string;
  diffAmount: number;
  ageDays: number;
  assigneeName: string;
  status: DiscrepancyStatus;
}

/** نقطة في رسم تطور نسبة المطابقة */
export interface MatchTrendPoint {
  month: string;
  rate: number;
}

export interface DashboardKpis {
  openSessions: number;
  openSessionsDelta: string;
  openDiscrepancies: number;
  openDiscrepanciesValueLabel: string;
  monthMatchRate: number;
  monthMatchRateDelta: string;
  overdueDiscrepancies: number;
}

/** صف في قائمة جلسات المطابقة */
export interface SessionListRow {
  id: number;
  partnerName: string;
  currency: CurrencyCode;
  periodLabel: '2026-08' | string;
  status: SessionStatus;
  matchRatePct: number | null; // null = لم تُشغَّل المطابقة بعد
  totalLines: number;
  openDiscrepancies: number;
  openDiscrepancyValue: number;
  createdByName: string;
  createdAtLabel: string;
}

/** جهة الكشف داخل جلسة المطابقة */
export type StatementSide = 'ours' | 'theirs';

/** خطأ تحقق في بند المعاينة */
export interface LineError {
  field: 'date' | 'description' | 'debit' | 'credit';
  message: string;
}

/** بند في معاينة كشف مستورد (قابل للتصحيح قبل الاعتماد — FR-3.3) */
export interface PreviewLine {
  lineNo: number;
  dateRaw: string; // كما استُخرج
  docType: string;
  docNo: string;
  description: string;
  ref: string;
  debitRaw: string;
  creditRaw: string;
}

/** نتيجة تحليل ملف حقيقي + أرقام التحقق المعلنة (إن ذُكرت في ترويسة الكشف) */
export interface ParsedStatement {
  opening: number | null;
  lines: PreviewLine[];
  announcedClosing: number | null;
  announcedCount: number | null;
}

/** معلومات كشف معتمد نهائياً عبر الخادم (Module 3) */
export interface CommittedStatementInfo {
  fileName: string;
  lines: PreviewLine[];
  parsed: ParsedStatement;
  statementId: number;
  totalDebit: number;
  totalCredit: number;
}

/** مجاميع محسوبة + نتائج محقق التوثيق الثلاثي (من تحليل العينة §2.3) */
export interface TotalsCheck {
  totalDebit: number;
  totalCredit: number;
  computedClosing: number;
  closingOk: boolean;
  countOk: boolean;
}

/** مصدر إدخال في خريطة المراجع (Q8) */
export type RefMapSource = 'manual' | 'auto_confirmed' | 'auto_suggested';

/** سطر في خريطة المراجع: رقمنا اليدوي ↔ رقمه الآلي */
export interface RefMapEntry {
  id: number;
  ourRef: string;
  theirRef: string;
  source: RefMapSource;
  addedLabel: string;
}

/** نوع التسوية المبلَّغة (Q9) */
export type AdjustmentType = 'discount' | 'return' | 'other';

/** سجل "تسويات مُبلَّغة": ما أبلغناه للمورد ولم نتحقق من تطبيقه بعد */
export interface NotifiedAdjustment {
  id: number;
  dateLabel: string;
  type: AdjustmentType;
  amount: number;
  currency: CurrencyCode;
  note: string;
}

/** حساب طرف بعملة واحدة (Q11: لكل عملة كشف مستقل) */
export interface PartnerAccount {
  /** معرف الحساب في الخادم — مفتاح تبويبات خريطة المراجع والتسويات والقوالب */
  accountId: number;
  currency: CurrencyCode;
  ledgerCode: string;
  dateWindowDays: number;
  ruleOrder: string[];
  lastSession: {
    periodLabel: string;
    matchRatePct: number;
    openDiscrepancies: number;
  } | null;
}

/** مرجع قالب استيراد محفوظ للطرف (FR-2.3) */
export interface ImportTemplateRef {
  id: string;
  name: string;
  kind: 'ours' | 'theirs';
  isDefault: boolean;
}

/** الطرف (مورد في الإصدار الأول — D6) */
export interface Partner {
  id: number;
  code: string;
  nameAr: string;
  nameEn?: string;
  phone?: string;
  email?: string;
  notes?: string;
  isActive: boolean;
  accounts: PartnerAccount[];
  refMap: RefMapEntry[];
  adjustments: NotifiedAdjustment[];
  templates: ImportTemplateRef[];
}

/** تعليق على فرق */
export interface DiscrepancyComment {
  id: number;
  authorName: string;
  createdAtLabel: string;
  text: string;
}

/** قواعد المطابقة (FR-4.1) */
export type MatchRule = 'exact_ref' | 'ref_map' | 'description_ref' | 'amount_date' | 'manual';

/** بند كشف في شاشة عمل المطابقة */
export interface WsLine {
  id: number;
  date: string; // DD/MM/YYYY
  docNo?: string;
  desc: string;
  ref: string;
  debit: number;
  credit: number;
}

/** ربط بين بنود الجهتين (1:1 أو 1:N) */
export interface MatchLink {
  id: number;
  rule: MatchRule;
  confidence: number | null; // null = يدوي
  ourLineIds: number[];
  theirLineIds: number[];
  isActive: boolean;
  createdBy: 'auto' | 'user';
  note?: string;
}

/** رمز سبب الفرق (FR-5.2) */
export interface ReasonCode {
  id: number;
  label: string;
}

/** صف فرق في القائمة (مبسط للعرض — التفاصيل في التحويم/الدرج) */
export interface DiscrepancyRow {
  id: number;
  sessionId: number;
  partnerName: string;
  currency: CurrencyCode;
  periodLabel: string;
  type: DiscrepancyType;
  summary: string;
  ourValue: string | null;
  theirValue: string | null;
  diffAmount: number;
  reasonCodeId: number | null;
  assigneeName: string | null;
  ageDays: number;
  status: DiscrepancyStatus;
  comments: DiscrepancyComment[];
}
