import { getSessionDetail } from '@/features/sessions/sessionsClient';
import type { SessionDetail } from '@/features/sessions/sessionsClient';
import { listDiscrepancies, listSessionComments } from '@/features/discrepancies/discrepanciesClient';
import type { DiscrepancyComment, DiscrepancyFull } from '@/features/discrepancies/discrepanciesClient';
import type { CompanySettings } from '@/features/settings/settingsClient';
import { fileUrl } from '@/shared/api/client';

/**
 * عميل التقارير (Module 6): تركيب تقرير الجلسة الرسمي من بيانات الخادم الحقيقية
 * (تفصيل الجلسة + فروقها) — والتفقيط العربي للمبالغ في خطاب اعتماد الرصيد.
 */

export interface ReportBalanceRow {
  label: string;
  ours: number;
  theirs: number;
  diff: number;
}

export interface ReportDiscrepancyRow {
  id: number;
  typeLabel: string;
  summary: string;
  ourValue: string;
  theirValue: string;
  diff: string;
  reasonLabel: string;
  statusLabel: string;
  /** ملاحظات الفريق الموثقة على هذا الفرق — تُطبع تحته (Module 7) */
  comments: Array<{ author: string; time: string; body: string }>;
}

export interface SessionReport {
  sessionId: number;
  reportNo: string;
  issuedLabel: string;
  isDraft: boolean;
  partnerName: string;
  partnerNameEn?: string;
  ledgerCode: string;
  currency: 'YER' | 'USD' | 'SAR';
  currencyNameAr: string;
  periodFrom: string;
  periodTo: string;
  companyName: string;
  companyContact: string;
  balances: ReportBalanceRow[];
  matchSummary: {
    matchedCount: number;
    matchedValueLabel: string;
    totalLines: number;
    matchRatePct: number;
  };
  discrepancies: ReportDiscrepancyRow[];
  closingBalanceTheirs: number;
  closingBalanceWords: string;
  /** مصدر الافتتاحي: مرحَّل آلياً من جلسة سابقة (+ سبب أي تعديل يدوي) — D9 */
  carryNote: string | null;
  /** رابط شعار الشركة بنفس قناة الجلسة — null إن لا شعار (M9) */
  logoUrl: string | null;
}

export const DISC_TYPE_LABELS: Record<DiscrepancyFull['type'], string> = {
  amount_diff: 'فرق مبلغ',
  date_diff: 'فرق تاريخ',
  ref_diff: 'فرق مرجع',
  ours_only: 'عندنا فقط',
  theirs_only: 'عندهم فقط',
};

export const DISC_STATUS_LABELS: Record<DiscrepancyFull['status'], string> = {
  new: 'جديد',
  in_progress: 'قيد المتابعة',
  resolved: 'محلول',
  accepted: 'مقبول',
};

const CURRENCY_NAMES: Record<'YER' | 'USD' | 'SAR', string> = {
  YER: 'ريال يمني',
  USD: 'دولار أمريكي',
  SAR: 'ريال سعودي',
};

const isoDate = (d: string | null | undefined): string =>
  d ? d.slice(0, 10).replace(/-/g, '/') : '—';

// ===== تفقيط المبالغ بالعربية (خطاب اعتماد الرصيد) =====

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

const threeDigits = (n: number): string => {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const ones = rest % 10;
      const tens = Math.floor(rest / 10);
      parts.push(ones ? `${ONES[ones]} و${TENS[tens]}` : TENS[tens]);
    }
  }
  return parts.join(' و');
};

const groupNames: Array<[number, string, string, string]> = [
  [1_000_000_000, 'مليار', 'ملياراً', 'مليارات'],
  [1_000_000, 'مليون', 'مليوناً', 'ملايين'],
  [1_000, 'ألف', 'ألفاً', 'آلاف'],
];

/** تفقيط عدد صحيح بالعربية الفصيحة (حتى المليارات) */
export function tafqitInteger(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'صفر';
  const parts: string[] = [];
  for (const [scale, one, two, plural] of groupNames) {
    const count = Math.floor(n / scale);
    if (!count) continue;
    n %= scale;
    if (count === 1) parts.push(one);
    else if (count === 2) parts.push(two);
    else if (count >= 3 && count <= 10) parts.push(`${threeDigits(count)} ${plural}`);
    else parts.push(`${threeDigits(count)} ${one}`);
  }
  if (n) parts.push(threeDigits(n));
  return parts.join(' و');
}

/** تفقيط مبلغ بعملته — «فقط خمسة وثلاثون ألف ريال يمني و 50/100 لا غير» */
export function tafqitAmount(amount: number, currency: 'YER' | 'USD' | 'SAR'): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.floor(abs);
  const fraction = Math.round((abs - whole) * 100);
  const base = `${tafqitInteger(whole)} ${CURRENCY_NAMES[currency]}`;
  const frac = fraction ? ` و ${fraction}/100` : '';
  return `فقط ${negative ? 'سالب ' : ''}${base}${frac} لا غير`;
}

// ===== تركيب التقرير من بيانات الخادم =====

const money = (v: number | null | undefined): string =>
  (v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface ReportBuildOptions {
  ledgerCode: string;
  partnerNameEn?: string;
  company: CompanySettings | null;
}

/** تنزيل تقرير الجلسة محلياً — Excel (ورقتا تسوية وفروق) أو PDF خلفي بخط عربي مضمّن */
export const exportSessionExcel = (sessionId: number): string =>
  fileUrl(`/api/v1/sessions/${sessionId}/export.xlsx`);
export const exportSessionPdf = (sessionId: number): string =>
  fileUrl(`/api/v1/sessions/${sessionId}/report.pdf`);

/** تجميع تقرير الجلسة من نداءي الخادم (التفصيل + الفروق) */
export async function fetchSessionReport(sessionId: number, opts: ReportBuildOptions): Promise<SessionReport> {
  const [detail, discrepancies, comments] = await Promise.all([
    getSessionDetail(sessionId),
    listDiscrepancies({ sessionId }),
    listSessionComments(sessionId).catch(() => [] as DiscrepancyComment[]),
  ]);
  return buildSessionReport(detail, discrepancies, comments, opts);
}

export function buildSessionReport(
  detail: SessionDetail,
  discrepancies: DiscrepancyFull[],
  comments: DiscrepancyComment[],
  opts: ReportBuildOptions,
): SessionReport {
  const commentsByDisc = new Map<number, DiscrepancyComment[]>();
  for (const c of comments) {
    const list = commentsByDisc.get(c.discrepancyId) ?? [];
    list.push(c);
    commentsByDisc.set(c.discrepancyId, list);
  }
  const { session, partner, ourStatement, theirStatement, progress } = detail;
  const currency = session.currencyCode;

  // الختامي عند المورد = الافتتاحي + مدين − دائن (من البنود الحقيقية؛ والمعلن يفوق إن وُجد)
  const theirDebit = (theirStatement?.lines ?? []).reduce((s, l) => s + (l.debit ?? 0), 0);
  const theirCredit = (theirStatement?.lines ?? []).reduce((s, l) => s + (l.credit ?? 0), 0);
  const computedClosingTheirs = (session.openingTheirs ?? 0) + theirDebit - theirCredit;
  const closingBalanceTheirs = theirStatement?.closing ?? computedClosingTheirs;

  const matchedCount =
    (ourStatement?.lines ?? []).filter((l) => l.remaining <= 0.005).length +
    (theirStatement?.lines ?? []).filter((l) => l.remaining <= 0.005).length;

  const balances: ReportBalanceRow[] = [
    { label: 'رصيد افتتاحي', ours: session.openingOurs ?? 0, theirs: session.openingTheirs ?? 0, diff: (session.openingOurs ?? 0) - (session.openingTheirs ?? 0) },
    { label: 'إجمالي مدين', ours: (ourStatement?.lines ?? []).reduce((s, l) => s + (l.debit ?? 0), 0), theirs: theirDebit, diff: 0 },
    { label: 'إجمالي دائن', ours: (ourStatement?.lines ?? []).reduce((s, l) => s + (l.credit ?? 0), 0), theirs: theirCredit, diff: 0 },
  ];
  balances[1].diff = balances[1].ours - balances[1].theirs;
  balances[2].diff = balances[2].ours - balances[2].theirs;

  const company = opts.company;
  const companyContact = [company?.address, company?.phone, company?.email].filter(Boolean).join(' · ');

  return {
    sessionId: session.id,
    reportNo: `REC-${session.id}-R1`,
    issuedLabel: new Date().toISOString().slice(0, 10).replace(/-/g, '/'),
    isDraft: session.status !== 'closed',
    partnerName: partner.nameAr,
    partnerNameEn: opts.partnerNameEn,
    ledgerCode: opts.ledgerCode,
    currency,
    currencyNameAr: CURRENCY_NAMES[currency],
    periodFrom: isoDate(theirStatement?.periodStart ?? ourStatement?.periodStart),
    periodTo: isoDate(theirStatement?.periodEnd ?? ourStatement?.periodEnd),
    companyName: company?.nameAr || 'شركة المؤسسة',
    companyContact: companyContact || 'العنوان · هاتف · بريد — من إعدادات الشركة',
    balances,
    matchSummary: {
      matchedCount,
      matchedValueLabel: money(progress.theirs.matchedConfirmed),
      totalLines: progress.ours.lineCount + progress.theirs.lineCount,
      matchRatePct: Math.round(progress.matchRatePct * 10) / 10,
    },
    discrepancies: discrepancies.map((d) => ({
      id: d.id,
      typeLabel: DISC_TYPE_LABELS[d.type],
      summary: d.lineDescription ?? '—',
      ourValue: d.ourAmount != null ? money(d.ourAmount) : '—',
      theirValue: d.theirAmount != null ? money(d.theirAmount) : '—',
      diff: d.diffAmount != null ? money(d.diffAmount) : '—',
      reasonLabel: d.reasonCodeName ?? 'غير محدد',
      statusLabel: DISC_STATUS_LABELS[d.status],
      comments: (commentsByDisc.get(d.id) ?? []).map((c) => ({
        author: c.authorName,
        time: c.createdAt.slice(0, 10),
        body: c.body,
      })),
    })),
    closingBalanceTheirs,
    closingBalanceWords: tafqitAmount(closingBalanceTheirs, currency),
    logoUrl: company?.logoFileName
      ? fileUrl('/api/v1/settings/company/logo')
      : null,
    carryNote:
      session.carriedFromSessionId != null
        ? `الرصيد الافتتاحي مرحَّل آلياً من جلسة ${session.carriedFromPeriod ?? '#' + session.carriedFromSessionId} المغلقة` +
          (session.openingAdjustReason
            ? ` — عُدِّل يدوياً والسبب: ${session.openingAdjustReason}`
            : ' — متصل بآخر إقفال موثق') +
          '.'
        : null,
  };
}
