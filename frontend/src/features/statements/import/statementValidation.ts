import type { LineError, PreviewLine, StatementSide, TotalsCheck } from '@/shared/types';

/**
 * قواعد فحص بنود الكشف المستورد — FR-3.4 + محقق التوثيق الثلاثي (stage-2b §2.3).
 * منفصلة عن الواجهة لقابلية الاختبار الآلي وإعادة الاستخدام.
 */

const DATE_RE = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/;
const DEFAULT_DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY/MM/DD', 'DD.MM.YYYY', 'MM/DD/YYYY'];
const normalizeNumerals = (text: string, decimalSep: string, thousandSep: string): string => text
  .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
  .replace(/\u066b/g, decimalSep)
  .replace(/\u066c/g, thousandSep);

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  يناير: 1, فبراير: 2, مارس: 3, ابريل: 4, أبريل: 4, مايو: 5, يونيو: 6, يونيه: 6,
  يوليو: 7, يوليه: 7, اغسطس: 8, أغسطس: 8, سبتمبر: 9, اكتوبر: 10, أكتوبر: 10,
  نوفمبر: 11, ديسمبر: 12,
};

/** نزع الوقت واسم اليوم كما يفعل الخادم حتى يتفق المحققان */
function stripDateNoise(value: string): string {
  return value
    .replace(/^\s*(?:السبت|الأحد|الاحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|sat(?:urday)?|sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?)\s*[,،]?\s*/i, '')
    .replace(/[T\s]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*(?:Z|[+-]\d{2}:?\d{2})?\s*$/i, '')
    .replace(/\s*(?:الساعة\s*)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:ص|م|صباحا|صباحاً|مساء|مساءً|am|pm|a\.?m\.?|p\.?m\.?)?\s*$/i, '')
    .trim();
}

function makeIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1990 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** تاريخ ISO أو null — نفس قواعد الخادم: صيغ مرتبة، سنة قصيرة، أسماء شهور، YYYYMMDD */
export function parseStatementDate(raw: string, formats: string[] = DEFAULT_DATE_FORMATS): string | null {
  const text = stripDateNoise(normalizeNumerals(String(raw ?? '').trim(), '.', ','));
  if (!text) return null;
  if (/^\d{8}$/.test(text)) return makeIso(Number(text.slice(0, 4)), Number(text.slice(4, 6)), Number(text.slice(6, 8)));

  const tokens = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (tokens.length >= 3) {
    const monthIndex = tokens.findIndex((token) => MONTH_NAMES[token.toLowerCase()] !== undefined);
    if (monthIndex >= 0) {
      const month = MONTH_NAMES[tokens[monthIndex].toLowerCase()];
      const numbers = tokens.filter((_, index) => index !== monthIndex).map((token) => (/^\d{1,4}$/.test(token) ? Number(token) : NaN));
      if (numbers.length >= 2 && !numbers.some((n) => Number.isNaN(n))) {
        const fourDigit = numbers.find((n) => n >= 1000);
        if (fourDigit !== undefined) {
          const day = numbers.find((n) => n !== fourDigit)!;
          return makeIso(fourDigit, month, day);
        }
        const year = numbers[numbers.length - 1] < 100 ? 2000 + numbers[numbers.length - 1] : numbers[numbers.length - 1];
        return makeIso(year, month, numbers[0]);
      }
    }
  }

  const m = DATE_RE.exec(text);
  if (!m) return null;
  const segments = [m[1], m[2], m[3]];
  const preferred = formats.length ? formats : DEFAULT_DATE_FORMATS;
  const tryFormat = (format: string): string | null => {
    const parts = format.split(/[/.-]/).map((part) => {
      const token = part.trim().toUpperCase();
      return token === 'YY' ? 'YYYY' : token;
    });
    if (parts.length !== 3) return null;
    const segmentFor = (token: 'YYYY' | 'MM' | 'DD'): string | null => {
      const index = parts.indexOf(token);
      return index < 0 ? null : segments[index];
    };
    const yearSegment = segmentFor('YYYY');
    const monthSegment = segmentFor('MM');
    const daySegment = segmentFor('DD');
    if (!yearSegment || !monthSegment || !daySegment) return null;
    let year = Number(yearSegment);
    if (yearSegment.length === 2) year += 2000;
    else if (yearSegment.length !== 4) return null;
    return makeIso(year, Number(monthSegment), Number(daySegment));
  };
  for (const format of preferred) {
    const parsed = tryFormat(format);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * تاريخ صالح فعلياً بأي صيغة شائعة داخل الصيغ المتاحة (الخادم هو الحَكَم عند الاعتماد).
 * الصيغة الأولى تفضّل عند الغموض، ثم تُجرّب البقية — لا يمر تاريخ مستحيل مثل 31/02.
 */
export function isValidStatementDate(raw: string, formats?: string[]): boolean {
  return parseStatementDate(raw, formats) !== null;
}

const CURRENCY_NOISE = /(?:YER|USD|SAR|AED|EUR|OMR|KWD|ر\.?ي\.?|ر\.?س\.?|ر\.?ع\.?|د\.?ك\.?|\$|€|﷼|ريال|دولار|درهم)/gi;
const MINUS_SIGNS = /[\u2212\u2013\u2014]/g;

/** مبلغ رقمي — يقبل العملة والفواصل والأقواس والسالب اللاحق، ويعيد الإشارة */
export function parseAmount(raw: string, decimalSep = '.', thousandSep = ','): number | null {
  if (!['.', ','].includes(decimalSep) || !['.', ','].includes(thousandSep) || decimalSep === thousandSep) return null;
  let text = normalizeNumerals(raw.replace(CURRENCY_NOISE, ''), decimalSep, thousandSep)
    .replace(/[\s\u00a0\u202f'’]/g, '')
    .replace(MINUS_SIGNS, '-')
    .trim();
  if (!text || text === '—' || text === '-') return null;
  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) { negative = true; text = text.slice(1, -1); }
  if (text.endsWith('-')) { negative = !negative; text = text.slice(0, -1); }
  if (text.startsWith('-')) { negative = !negative; text = text.slice(1); }
  if (text.startsWith('+')) text = text.slice(1);

  const decimal = decimalSep === '.' ? '\\.' : ',';
  const thousands = thousandSep === '.' ? '\\.' : ',';
  const format = new RegExp(`^(?:\\d{1,3}(?:${thousands}\\d{3})+|\\d+)(?:${decimal}\\d{1,4})?$`);
  if (format.test(text)) {
    const value = Number(text.split(thousandSep).join('').replace(decimalSep, '.'));
    return Number.isFinite(value) ? (negative ? -value : value) : null;
  }
  // فواصل معكوسة عن إعدادات القالب: آخر فاصل يتبعه ١–٤ أرقام هو العشري
  const decimalIndex = Math.max(text.lastIndexOf('.'), text.lastIndexOf(','));
  if (decimalIndex <= 0 || decimalIndex === text.length - 1) return null;
  const fraction = text.slice(decimalIndex + 1);
  if (!/^\d{1,4}$/.test(fraction)) return null;
  const inferredDecimal = text[decimalIndex];
  const inferredThousands = inferredDecimal === '.' ? ',' : '.';
  const inferredPattern = inferredDecimal === '.' ? '\\.' : ',';
  const inferredThousandsPattern = inferredThousands === '.' ? '\\.' : ',';
  const inferredFormat = new RegExp(`^(?:\\d{1,3}(?:${inferredThousandsPattern}\\d{3})+|\\d+)(?:${inferredPattern}\\d{1,4})?$`);
  if (!inferredFormat.test(text)) return null;
  const value = Number(text.split(inferredThousands).join('').replace(inferredDecimal, '.'));
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

/** فحص بند واحد — يعيد قائمة أخطاءه (فراغ = سليم) */
export function validateLine(line: PreviewLine, decimalSep = '.', thousandSep = ',', dateFormats?: string[]): LineError[] {
  const errors: LineError[] = [];

  if (!line.description.trim()) {
    errors.push({ field: 'description', message: 'البيان فارغ — أدخل وصف البند' });
  }
  if (!isValidStatementDate(line.dateRaw, dateFormats)) {
    errors.push({
      field: 'date',
      message: `تاريخ غير مفهوم: «${line.dateRaw}» — مثال مقبول: 31/12/2026`,
    });
  }
  const hasDebit = line.debitRaw.trim() !== '';
  const hasCredit = line.creditRaw.trim() !== '';
  if (!hasDebit && !hasCredit) {
    errors.push({ field: 'debit', message: 'البند بلا مدين ولا دائن' });
  }
  const debit = hasDebit ? parseAmount(line.debitRaw, decimalSep, thousandSep) : null;
  const credit = hasCredit ? parseAmount(line.creditRaw, decimalSep, thousandSep) : null;
  if (hasDebit && debit === null) {
    errors.push({ field: 'debit', message: `مدين غير رقمي: «${line.debitRaw}»` });
  }
  if (hasCredit && credit === null) {
    errors.push({ field: 'credit', message: `دائن غير رقمي: «${line.creditRaw}»` });
  }
  // الاتجاه في المعاينة موجب دائماً؛ السالب في عمود صريح يعني خطأ تعيين/إشارة
  if (debit !== null && debit < 0) {
    errors.push({ field: 'debit', message: `المدين لا يكون سالباً: «${line.debitRaw}»` });
  }
  if (credit !== null && credit < 0) {
    errors.push({ field: 'credit', message: `الدائن لا يكون سالباً: «${line.creditRaw}»` });
  }
  // مدين+دائن معاً مسموح (عرف محاسبي: فاتورة سُددت نقداً تظهر بالجهتين في سطر واحد)
  return errors;
}

function toNumber(raw: string, decimalSep: string, thousandSep: string): number {
  return parseAmount(raw, decimalSep, thousandSep) ?? 0;
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
  decimalSep = '.',
  thousandSep = ',',
): TotalsCheck {
  const totalDebit = lines.reduce((sum, l) => sum + toNumber(l.debitRaw, decimalSep, thousandSep), 0);
  const totalCredit = lines.reduce((sum, l) => sum + toNumber(l.creditRaw, decimalSep, thousandSep), 0);
  // اتجاه الرصيد (الوثيقة الكنسية §57): كشفهم مدين = افتتاحي + مدين − دائن،
  // وكشفنا دائن = افتتاحي + دائن − مدين (أي نظام: رصيد المورد دائن عنده)
  const computedClosing =
    (opening ?? 0) + (side === 'ours' ? totalCredit - totalDebit : totalDebit - totalCredit);
  return {
    totalDebit,
    totalCredit,
    computedClosing,
    // بلا قيم معلنة = لا مقارنة (تظهر «غير معلن» في اللوحة) — الفحص الصارم عند الاعتماد
    closingOk: announcedClosing === null || Math.abs(computedClosing - announcedClosing) < 0.00005,
    countOk: announcedCount === null || lines.length === announcedCount,
  };
}

export function formatMoney(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
