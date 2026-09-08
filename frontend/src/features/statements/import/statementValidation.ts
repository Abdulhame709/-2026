import type { LineError, PreviewLine, StatementSide, TotalsCheck } from '@/shared/types';

/**
 * قواعد فحص بنود الكشف المستورد — FR-3.4 + محقق التوثيق الثلاثي (stage-2b §2.3).
 * منفصلة عن الواجهة لقابلية الاختبار الآلي وإعادة الاستخدام.
 */

const DATE_RE = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/;

/**
 * تاريخ صالح فعلياً بأي صيغة شائعة: YYYY-MM-DD أو DD/MM/YYYY أو DD-MM-YYYY
 * (سنة قصيرة 26 = 2026). قراءة يوم-أولاً مقدَّمة — عرف الكشوفات المحلي.
 */
export function isValidStatementDate(raw: string): boolean {
  const m = DATE_RE.exec(raw.trim());
  if (!m) return false;
  let day: number;
  let month: number;
  let year: number;
  if (m[1].length === 4) {
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  } else {
    day = Number(m[1]);
    month = Number(m[2]);
    year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth;
}

/** مبلغ رقمي — يتغاضى عن ضوضاء العملة (ر.ي / ﷼ / $) وفواصل الآلاف */
export function parseAmount(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/[^\d.,-]/g, '')
    .replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** فحص بند واحد — يعيد قائمة أخطاءه (فراغ = سليم) */
export function validateLine(line: PreviewLine): LineError[] {
  const errors: LineError[] = [];

  if (!line.description.trim()) {
    errors.push({ field: 'description', message: 'البيان فارغ — أدخل وصف البند' });
  }
  if (!isValidStatementDate(line.dateRaw)) {
    errors.push({
      field: 'date',
      message: `تاريخ غير مفهوم: «${line.dateRaw}» — الصيغة المطلوبة DD/MM/YYYY`,
    });
  }
  const hasDebit = line.debitRaw.trim() !== '';
  const hasCredit = line.creditRaw.trim() !== '';
  if (!hasDebit && !hasCredit) {
    errors.push({ field: 'debit', message: 'البند بلا مدين ولا دائن' });
  }
  if (hasDebit && parseAmount(line.debitRaw) === null) {
    errors.push({ field: 'debit', message: `مدين غير رقمي: «${line.debitRaw}»` });
  }
  if (hasCredit && parseAmount(line.creditRaw) === null) {
    errors.push({ field: 'credit', message: `دائن غير رقمي: «${line.creditRaw}»` });
  }
  // مدين+دائن معاً مسموح (عرف محاسبي: فاتورة سُددت نقداً تظهر بالجهتين في سطر واحد)
  return errors;
}

function toNumber(raw: string): number {
  return parseAmount(raw) ?? 0;
}

/**
 * محقق التوثيق الثلاثي: يجب أن يتسق (الافتتاحي + Σمدين − Σدائن = الختامي المعلن)
 * وأن يطابق عدد البنود العدد المعلن في ترويسة الكشف.
 */
export function computeTotalsCheck(
  lines: PreviewLine[],
  opening: number | null,
  side: StatementSide,
  announcedClosing: number | null,
  announcedCount: number | null,
): TotalsCheck {
  const totalDebit = lines.reduce((sum, l) => sum + toNumber(l.debitRaw), 0);
  const totalCredit = lines.reduce((sum, l) => sum + toNumber(l.creditRaw), 0);
  // اتجاه الرصيد (الوثيقة الكنسية §57): كشفهم مدين = افتتاحي + مدين − دائن،
  // وكشفنا دائن = افتتاحي + دائن − مدين (أي نظام: رصيد المورد دائن عنده)
  const computedClosing =
    (opening ?? 0) + (side === 'ours' ? totalCredit - totalDebit : totalDebit - totalCredit);
  return {
    totalDebit,
    totalCredit,
    computedClosing,
    // بلا قيم معلنة = لا مقارنة (تظهر «غير معلن» في اللوحة) — الفحص الصارم عند الاعتماد
    closingOk: announcedClosing === null || Math.abs(computedClosing - announcedClosing) < 0.005,
    countOk: announcedCount === null || lines.length === announcedCount,
  };
}

export function formatMoney(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}