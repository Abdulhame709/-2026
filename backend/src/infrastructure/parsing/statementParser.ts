import * as XLSX from 'xlsx';
import { AppError, ERR } from '../../domain/errors.js';

/**
 * محلل الكشوفات — Excel/CSV (Module 3).
 * الفلسفة: نستخرج النص الخام كما هو (dateRaw/debitRaw…) — التصحيح البشري على الخام
 * في المعاينة (FR-3.3) والتحويل النهائي للأرقام/التواريخ عند الاعتماد فقط.
 * PDF الرقمي/الممسوح: مسار OCR منفصل (D5) — هنا رسالة واضحة بدل فشل صامت.
 *
 * تعيين الأعمدة (2026-11-27): القالب يربط حقلاً بحرف عمود، ويدعم الآن:
 *   - مدين/دائن صريحين، أو
 *   - عمود مبلغ واحد (أو «رصيد» عند غياب المبلغ) تُستنتج منه الجهة حسب إشارة القيمة وجهة الكشف.
 */

export const FIELD_KEYS = [
  'date',
  'docType',
  'docNo',
  'description',
  'ref',
  'debit',
  'credit',
  'amount',
  'balance',
  'currency',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export type StatementSide = 'ours' | 'theirs';

export interface TemplateMapping {
  headerRows: number;
  /** date/docType/docNo/description/ref/debit/credit/amount/balance/currency → حرف عمود */
  columnsMapping: Record<string, string>;
  dateFormats: string[];
  decimalSep: string;
  thousandSep: string;
}

export interface RawLine {
  lineNo: number;
  dateRaw: string;
  docType: string;
  docNo: string;
  description: string;
  ref: string;
  debitRaw: string;
  creditRaw: string;
  ocrConfidence?: number | null;
}

export interface ParseResult {
  lines: RawLine[];
  opening: number | null; // رصيد افتتاحي مكتشف من الترويسة (أفضل جهد)
  closingHint: number | null;
  sheetName: string;
  /** أسماء كل أوراق المصنف — لاختيار ورقة أخرى من الواجهة */
  sheetNames: string[];
  /** صفوف غير بندية تُخطّيت (ترويسات مكررة/مجاميع/أرصدة) — للشفافية في الواجهة */
  ignoredRows: number;
}

export interface WorkbookSheet {
  name: string;
  rows: unknown[][];
  /** ورقة مخفية في المصنف (قالب/مراجع) — لا تُختار تلقائياً ما دامت هناك ورقة ظاهرة */
  hidden?: boolean;
}

/** سقوف أمان: نطاق منسّق وهمي بمليون صف أو أعمدة زائدة يرفع الذاكرة بلا فائدة */
const MAX_SHEET_ROWS = 200_000;
const MAX_SHEET_COLUMNS = 1_000;
const CSV_DELIMITERS = ['\t', ';', ',', '|'] as const;

/** حرف عمود Excel (A=0…) → رقم */
export function columnIndex(letter: string): number | null {
  const m = /^[A-Za-z]{1,2}$/.exec(letter.trim());
  if (!m) return null;
  let idx = 0;
  for (const ch of letter.toUpperCase()) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
}

/** رقم عمود (0-based) → حرف Excel (A, B, … AA) */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const CURRENCY_NOISE = /(?:YER|USD|SAR|AED|EUR|OMR|KWD|ر\.?ي\.?|ر\.?س\.?|ر\.?ع\.?|د\.?ك\.?|\$|€|﷼|ريال|دولار|درهم)/gi;
const MINUS_SIGNS = /[\u2212\u2013\u2014]/g;
const normalizeNumerals = (text: string, decimalSep: string, thousandSep: string): string => text
  .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
  .replace(/\u066b/g, decimalSep)
  .replace(/\u066c/g, thousandSep);

/**
 * تنظيف خلية مبلغ: حذف العملة والمسافات وأقواس المحاسبة والسالب اللاحق.
 * «(1,234.56)» و«1,234.56-» و«−1,234.56» كلها سالبة — عرف كشوفات شائع.
 */
function cleanAmount(raw: string, decimalSep: string, thousandSep: string): { text: string; negative: boolean } {
  let text = normalizeNumerals(String(raw ?? ''), decimalSep, thousandSep)
    .replace(CURRENCY_NOISE, '')
    .replace(/[\s\u00a0\u202f'’]/g, '')
    .replace(MINUS_SIGNS, '-')
    .trim();
  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.endsWith('-')) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  }
  if (text.startsWith('+')) text = text.slice(1);
  return { text, negative };
}

/** تحويل نص رقمي نظيف لفاصل عشري وآخر للآلاف — null لو التركيب غير متسق */
function scaledAmount(text: string, decimalSep: string, thousandSep: string): number | null {
  if (!text) return null;
  const decimal = decimalSep === '.' ? '\\.' : ',';
  const thousands = thousandSep === '.' ? '\\.' : ',';
  const format = new RegExp(`^(?:\\d{1,3}(?:${thousands}\\d{3})+|\\d+)(?:${decimal}\\d{1,4})?$`);
  if (!format.test(text)) return null;
  const amount = Number(text.split(thousandSep).join('').replace(decimalSep, '.'));
  return Number.isFinite(amount) ? amount : null;
}

/**
 * استنتاج الفواصل عند فشل إعدادات القالب: آخر فاصل يتبعه 1–4 أرقام هو العشري.
 * يعالج كشوفات «1234,56» (فاصلة عشرية بلا آلاف) و«1.234,56» مع قالب خاطئ.
 */
function inferredAmount(text: string): number | null {
  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  const decimalIndex = Math.max(lastDot, lastComma);
  if (decimalIndex <= 0 || decimalIndex === text.length - 1) return null;
  const fraction = text.slice(decimalIndex + 1);
  if (!/^\d{1,4}$/.test(fraction)) return null;
  const decimalSep = text[decimalIndex];
  const thousandSep = decimalSep === '.' ? ',' : '.';
  return scaledAmount(text, decimalSep, thousandSep);
}

/** نص خام → رقم حسب فواصل القالب، مع استنتاج آمن عند اختلاف الملف — null لو لا يُحلَّل */
export function parseAmount(raw: string, decimalSep: string, thousandSep: string): number | null {
  if (!['.', ','].includes(decimalSep) || !['.', ','].includes(thousandSep) || decimalSep === thousandSep) return null;
  const { text, negative } = cleanAmount(raw, decimalSep, thousandSep);
  if (!text || text === '—' || text === '-') return null;
  const amount = scaledAmount(text, decimalSep, thousandSep) ?? inferredAmount(text);
  if (amount === null) return null;
  return negative ? -amount : amount;
}

/** تنسيق تاريخ JS → YYYY-MM-DD (بتوقيت محلي — مناسب لكائنات Date من Excel) */
function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** تنسيق تاريخ UTC → YYYY-MM-DD (للأرقام التسلسلية حتى لا يزحف اليوم حسب توقيت الجهاز) */
function isoDateUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** بناء تاريخ صالح أو null — يمنع 31 فبراير ويقبل السنوات 1990–2099 فقط */
function makeIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1990 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  يناير: 1, فبراير: 2, مارس: 3, ابريل: 4, أبريل: 4, مايو: 5, يونيو: 6, يونيه: 6,
  يوليو: 7, يوليه: 7, اغسطس: 8, أغسطس: 8, سبتمبر: 9, اكتوبر: 10, أكتوبر: 10,
  نوفمبر: 11, ديسمبر: 12,
};

/**
 * نزع الوقت/اسم اليوم من نص التاريخ: «2026-01-31 10:20»، «31/01/2026 10:20:05 م»،
 * «2026-01-31T10:20:00Z». يبقى التاريخ وحده قابلاً للتحليل بالصيغ المعروفة.
 */
function stripDateNoise(value: string): string {
  return value
    .replace(/^\s*(?:السبت|الأحد|الاحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|sat(?:urday)?|sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?)\s*[,،]?\s*/i, '')
    .replace(/[T\s]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*(?:Z|[+-]\d{2}:?\d{2})?\s*$/i, '')
    .replace(/\s*(?:الساعة\s*)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:ص|م|صباحا|صباحاً|مساء|مساءً|am|pm|a\.?m\.?|p\.?m\.?)?\s*$/i, '')
    .trim();
}

/** تاريخ بأسماء الشهور: «31 يناير 2026» / «Jan 31, 2026» / «31-Jan-26» */
function parseNamedMonth(text: string): string | null {
  const tokens = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (tokens.length < 3) return null;
  const monthIndex = tokens.findIndex((token) => MONTH_NAMES[token.toLowerCase()] !== undefined);
  if (monthIndex < 0) return null;
  const month = MONTH_NAMES[tokens[monthIndex].toLowerCase()];
  const numbers = tokens
    .filter((_, index) => index !== monthIndex)
    .map((token) => (/^\d{1,4}$/.test(token) ? Number(token) : NaN));
  if (numbers.length < 2 || numbers.some((n) => Number.isNaN(n))) return null;
  let year: number;
  let day: number;
  const fourDigit = numbers.find((n) => n >= 1000);
  if (fourDigit !== undefined) {
    year = fourDigit;
    day = numbers.find((n) => n !== fourDigit)!;
  } else {
    // بلا سنة صريحة: آخر رقمين هما اليوم/السنة القصيرة
    year = numbers[numbers.length - 1] + (numbers[numbers.length - 1] < 100 ? 2000 : 0);
    day = numbers[0];
  }
  return makeIso(year, month, day);
}

/**
 * نص/تاريخ Excel → YYYY-MM-DD حسب صيغ القالب — null لو فشل.
 * يقبل: Date، التسلسلي، YYYYMMDD، الصيغ الرقمية المعروفة (مع أو بلا وقت)،
 * وأسماء الشهور العربية/الإنجليزية. الصيغة الأولى في القائمة هي المفضّلة عند الغموض.
 */
export function parseDate(raw: unknown, formats: string[]): string | null {
  const candidates = formats?.length ? formats : ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY/MM/DD'];
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return isoDate(raw);
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (Number.isInteger(raw) && raw >= 19000101 && raw <= 20991231) {
      // تاريخ مضغوط YYYYMMDD (يظهر كثيراً في تصديرات الأنظمة المحاسبية)
      return makeIso(Math.floor(raw / 10000), Math.floor(raw / 100) % 100, raw % 100);
    }
    if (raw > 0 && raw < 2958466) {
      // رقم تسلسلي Excel (منذ 1899-12-30)، بما فيه كسر الوقت — بتوقيت UTC
      return isoDateUtc(new Date(Math.round((raw - 25569) * 86400000)));
    }
    return null;
  }

  let s = normalizeNumerals(String(raw ?? '').trim(), '.', ',');
  if (!s) return null;
  s = stripDateNoise(s);
  if (!s) return null;

  const named = parseNamedMonth(s);
  if (named) return named;

  // تاريخ مضغوط بلا فواصل: 20260131
  if (/^\d{8}$/.test(s)) {
    return makeIso(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));
  }

  const segments = s.split(/[/\-.]/).map((x) => x.trim()).filter((x) => x !== '');
  if (segments.length !== 3 || segments.some((segment) => !/^\d{1,4}$/.test(segment))) return null;

  /** محاولة صيغة واحدة — lenient: YYYY يقبل سنة قصيرة (26→2026) بعد فشل الصارم */
  const tryFormat = (fmt: string, lenient = false): string | null => {
    const parts = fmt
      .split(/[/\-.]/)
      .map((x) => x.trim().toUpperCase())
      .map((token) => (token === 'YY' ? 'YYYY' : token));
    if (parts.length !== segments.length) return null;
    const get = (token: string): { segment: string; value: number } | null => {
      const i = parts.indexOf(token);
      if (i < 0) return null;
      const segment = segments[i];
      // الصرامة تمنع 2030 بدل 2026: YYYY الصارم يلزمه 4 أرقام بالضبط
      if (token === 'YYYY' && !lenient && segment.length !== 4) return null;
      if (token !== 'YYYY' && segment.length > 2) return null;
      const value = Number(segment);
      return Number.isInteger(value) ? { segment, value } : null;
    };
    const yearPart = get('YYYY');
    const monthPart = get('MM');
    const dayPart = get('DD');
    if (!yearPart || !monthPart || !dayPart) return null;
    let year = yearPart.value;
    if (year < 100) year += 2000;
    return makeIso(year, monthPart.value, dayPart.value);
  };

  for (const fmt of candidates) {
    const strict = tryFormat(fmt);
    if (strict) return strict;
  }
  // التمريرة المتساهلة (سنة قصيرة): صيغ «يوم-أولاً» مقدَّمة — العرف المحلي DD/MM
  // يتفوق على قراءة سنة-أولاً حين يكون التفسيران متاحان (30-06-26 = 2026-06-30 لا 2030)
  const dayFirst = candidates.filter((f) => !f.trim().toUpperCase().startsWith('YYYY'));
  const yearFirst = candidates.filter((f) => f.trim().toUpperCase().startsWith('YYYY'));
  for (const fmt of [...dayFirst, ...yearFirst]) {
    const lenient = tryFormat(fmt, true);
    if (lenient) return lenient;
  }
  return null;
}

/** خلايا ملفات Trend تحمل علامات اتجاه خفية تكسر البحث العربي — تُنزع هنا دائماً */
export const CELL = (v: unknown): string =>
  v instanceof Date ? isoDate(v) : String(v ?? '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').trim();

/** قراءة مصنف Excel/CSV والتحقق من التوقيع والترميز — مشتركة بين الفحص والتحليل */
export function readStatementWorkbook(buffer: Buffer, filename: string): { ext: string; sheets: WorkbookSheet[] } {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') {
    throw ERR.VALIDATION([
      { field: 'file', messageAr: 'مسار PDF (الرقمي والممسوح عبر OCR) منفصل — استخدم Excel/CSV هنا أو مسار PDF/الصورة' },
    ]);
  }
  if (!['xlsx', 'xls', 'csv'].includes(ext)) {
    throw ERR.VALIDATION([{ field: 'file', messageAr: 'صيغة غير مدعومة — المسموح: xlsx / xls / csv' }]);
  }

  const isXlsx = buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const isXls = buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  let csvContent: string | null = null;
  if (ext === 'csv' && buffer.length && !isXlsx && !isXls) {
    const utf16le = buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]));
    const utf16be = buffer.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]));
    let encodings: string[];
    if (utf16le) encodings = ['utf-16le'];
    else if (utf16be) encodings = ['utf-16be'];
    else {
      // UTF-16 بلا BOM (بعض أدوات التصدير): الحروف اللاتينية/العربية يتبعها بايت صفري
      // في LE، أو يسبقها في BE. نكشفها من توزّع الأصفار قبل تجربة UTF-8/1256.
      const head = buffer.subarray(0, Math.min(buffer.length, 512));
      let evenZeros = 0;
      let oddZeros = 0;
      for (let index = 0; index + 1 < head.length; index += 2) {
        if (head[index] === 0) evenZeros += 1;
        if (head[index + 1] === 0) oddZeros += 1;
      }
      const pairs = Math.floor(head.length / 2);
      const bomlessUtf16 = pairs >= 8 && (evenZeros > pairs * 0.3 || oddZeros > pairs * 0.3);
      encodings = bomlessUtf16
        ? [oddZeros >= evenZeros ? 'utf-16le' : 'utf-16be']
        : ['utf-8', 'windows-1256'];
    }
    // تصديرات Excel العربية على Windows كثيراً ما تكون CSV بترميز Windows-1256،
    // لا UTF-8. نحاول UTF-8/UTF-16 أولاً ثم 1256 قبل رفض الملف.
    for (const encoding of encodings) {
      try {
        const content = new TextDecoder(encoding, { fatal: true }).decode(buffer);
        if (!/[\u0000-\u0008\u000e-\u001f]/.test(content)) {
          csvContent = content.replace(/^\ufeff/, '');
          break;
        }
      } catch {
        // جرّب الترميز التالي
      }
    }
  }
  if ((ext === 'xlsx' && !isXlsx) || (ext === 'xls' && !isXls) || (ext === 'csv' && csvContent === null)) {
    throw ERR.VALIDATION([{ field: 'file', messageAr: 'امتداد الملف لا يطابق محتواه أو ترميز CSV غير مدعوم — أعد تصديره UTF-8 أو CSV من Excel' }]);
  }

  /** أول سطر غير فارغ: يحدد `sep=;` أو الفاصل الغالب (بعض أدوات Excel تصدّر ; أو Tab أو |) */
  const detectCsvFormat = (content: string): { content: string; FS?: string } => {
    const lines = content.split(/\r\n|\r|\n/);
    let firstIndex = 0;
    while (firstIndex < lines.length && !lines[firstIndex].trim()) firstIndex += 1;
    const firstLine = lines[firstIndex] ?? '';
    const sep = /^sep=(\\t|.)\s*$/i.exec(firstLine.trim());
    if (sep) {
      const delimiter = sep[1] === '\\t' ? '\t' : sep[1];
      return { content: lines.slice(firstIndex + 1).join('\n'), FS: delimiter };
    }
    // عدّ الفواصل في أول أسطر غير فارغة (قد يسبق الترويسة عنوان بلا فواصل).
    // فاصل الأعمدة يتكرر في كل سطر، بينما الفاصلة العشرية تظهر في خلايا المبالغ فقط.
    const countOutsideQuotes = (line: string, delimiter: string) => {
      let count = 0;
      let quoted = false;
      for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (!quoted && ch === delimiter) count += 1;
      }
      return count;
    };
    const sampleLines = lines.slice(firstIndex, firstIndex + 5).filter((line) => line.trim());
    const totals = new Map<string, number>(CSV_DELIMITERS.map((delimiter) => [delimiter, 0]));
    for (const line of sampleLines) {
      for (const delimiter of CSV_DELIMITERS) {
        totals.set(delimiter, (totals.get(delimiter) ?? 0) + countOutsideQuotes(line, delimiter));
      }
    }
    const best = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
    return best[1] > 0 ? { content, FS: best[0] } : { content };
  };

  /** نطاق الورقة قد يكون منسّقاً بالكامل إلى مليون صف — نرفض قبل بناء مصفوفة ضخمة */
  const assertSheetSize = (name: string, sheet: XLSX.WorkSheet): void => {
    const ref = sheet['!ref'];
    if (!ref) return;
    const range = XLSX.utils.decode_range(ref);
    const rows = range.e.r - range.s.r + 1;
    const columns = range.e.c - range.s.c + 1;
    if (rows > MAX_SHEET_ROWS || columns > MAX_SHEET_COLUMNS) {
      throw ERR.VALIDATION([{
        field: 'file',
        messageAr: `الورقة «${name}» أكبر من الحد الآمن (${MAX_SHEET_ROWS} صفاً × ${MAX_SHEET_COLUMNS} عموداً) — احذف الصفوف/الأعمدة الفارغة المنسّقة وأعد التصدير`,
      }]);
    }
  };

  try {
    let workbook: XLSX.WorkBook;
    if (ext === 'csv') {
      const csv = detectCsvFormat(csvContent!);
      // raw: true — لا يُحوّل CSV النص إلى أرقام/تواريخ، فنحفظ النص الخام (فواصل/أرقام عربية) للتحليل والتصحيح
      workbook = XLSX.read(csv.content, { type: 'string', cellDates: true, raw: true, FS: csv.FS, sheetRows: MAX_SHEET_ROWS + 1 });
    } else {
      workbook = XLSX.read(buffer, { cellDates: true, sheetRows: MAX_SHEET_ROWS + 1 });
    }
    const sheetMeta = (workbook.Workbook as { Sheets?: Array<{ Hidden?: number }> } | undefined)?.Sheets;
    const sheets: WorkbookSheet[] = workbook.SheetNames.map((name, index) => {
      const sheet = workbook.Sheets[name];
      assertSheetSize(name, sheet);
      return {
        name,
        hidden: (sheetMeta?.[index]?.Hidden ?? 0) !== 0,
        rows: XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' }),
      };
    });
    if (!sheets.length) {
      throw ERR.VALIDATION([{ field: 'file', messageAr: 'المصنف لا يحتوي أي ورقة — أعد تصديره من Excel' }]);
    }
    return { ext, sheets };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw ERR.VALIDATION([{ field: 'file', messageAr: 'تعذر قراءة الملف — تأكد أنه Excel/CSV سليم' }]);
  }
}

/**
 * قيمة مبلغ موقّعة → مدين/دائن حسب جهة الكشف (الوثيقة الكنسية §57):
 * كشفنا: الموجب دائن (رصيد المورد دائن عندنا) — كشفهم: الموجب مدين.
 */
export function amountToDebitCredit(value: number, side: StatementSide): { debitRaw: string; creditRaw: string } {
  const increaseIsCredit = side === 'ours';
  if (value >= 0) {
    return increaseIsCredit
      ? { debitRaw: '', creditRaw: String(value) }
      : { debitRaw: String(value), creditRaw: '' };
  }
  return increaseIsCredit
    ? { debitRaw: String(-value), creditRaw: '' }
    : { debitRaw: '', creditRaw: String(-value) };
}

/**
 * تحليل صفوف كشف مُهيّأة مسبقاً — القواعد المشتركة بين Excel/CSV وشبكة PDF:
 * تخطّي الترويسات المكررة ومجاميع الأرصدة، واستنتاج المدين/الدائن من عمود
 * مبلغ واحد حسب جهة الكشف. تُستدعى من `parseStatementFile` ومن مسار PDF.
 */
export function parseStatementRows(
  rows: unknown[][],
  template: TemplateMapping,
  side: StatementSide = 'theirs',
): Omit<ParseResult, 'sheetName' | 'sheetNames'> {
  const col = {} as Record<FieldKey, number | null>;
  for (const key of FIELD_KEYS) {
    const letter = template.columnsMapping[key];
    col[key] = letter ? columnIndex(letter) : null;
  }
  if (col.date == null) {
    throw ERR.VALIDATION([{ field: 'template', messageAr: 'القالب لا يحدد عمود التاريخ (date) — عدّل تعيين الأعمدة' }]);
  }
  // عمود المبلغ/الرصيد يُستخدم فقط عند غياب مدين/دائن صريحين — وإلا لتحوّلت أعمدة
  // مثل «قيمة البضاعة» أو «الرصيد» إلى حركات وهمية تسرق المجاميع.
  const hasExplicitSides = col.debit != null || col.credit != null;
  const amountKey: FieldKey | null = hasExplicitSides
    ? null
    : col.amount != null ? 'amount' : col.balance != null ? 'balance' : null;

  const lines: RawLine[] = [];
  let opening: number | null = null;
  /** ظهر صف افتتاحي صريح ولو كان مبلغه فارغاً — كي لا يُلتقط أول إجمالي كافتتاحي */
  let openingSeen = false;
  let closingHint: number | null = null;
  /** رصيد عام (إجمالي/رصيد بلا وصف صريح) — لا يسبق الرصيد الختامي الصريح */
  let genericClosing: number | null = null;
  /** آخر رصيد جارٍ في صف حركة — تقدير ختامي عند غياب صف «رصيد ختامي» صريح */
  let lastBalance: number | null = null;
  let ignoredRows = 0;
  const amountOf = (v: unknown) => parseAmount(CELL(v), template.decimalSep, template.thousandSep);

  /** كلمات صفوف الملخص: رصيد/إجمالي/مجموع/نهائي — بلا مساس ببنود فيها «رصيد فاتورة» */
  const TOTAL_ROW = /^(?:ال)?(?:رصيد|اجمالي|إجمالي|مجموع|نهائي|ختامي|total|balance|closing|opening)(?=$|[\s:\-–—])/i;
  /** مجاميع/تذييلات تظهر داخل النص لا في أوله («YER إجمالي العمليات»، «معلقات فواتير نقدية») */
  const SUMMARY_ANYWHERE = /(اجمالي|إجمالي|مجموع|الفرق بين|صافي الرصيد|صافي|معلقات|تدوير ارصده|تدوير الأرصدة|رصيد ما قبله)/i;
  const OPENING_ROW = /(افتتاحي|فتتاحي|سابق|مدور|opening|beginning|b\/f|رصيد ما قبله)/i;
  const CLOSING_ROW = /((?:رصيد|balance)[^\n]{0,16}(?:ختامي|نهائي|closing|ending)|closing|ending|c\/f|رصيد مستحق)/i;
  /** صف ترويسة مكرر داخل الجدول: كلماته من أسماء الأعمدة لا من بيانات حقيقية */
  const HEADER_WORD = /^(?:التاريخ|تاريخ|البيان|بيان|الوصف|وصف|المبلغ|مبلغ|مدين|دائن|الرصيد|رصيد|المرجع|مرجع|رقم|نوع|العملة|date|description|details|debit|credit|amount|balance|reference|ref|no\.?|number|type|currency)(?=$|[\s:.\-])/i;

  // تخطي صفوف الترويسة المعرفة بالقالب (headerRows) — ثم فحص الأرصدة والبنود
  rows.slice(Math.max(0, template.headerRows)).forEach((row) => {
    const at = (key: FieldKey): string => {
      const idx = col[key];
      return idx == null || row[idx] === undefined ? '' : CELL(row[idx]);
    };
    const dateRaw = at('date');
    const amountRaw = amountKey ? at(amountKey) : '';
    let debitRaw = at('debit');
    let creditRaw = at('credit');
    const description = at('description');
    const docNo = at('docNo');
    const ref = at('ref');
    const rowText = [description, dateRaw, docNo, ref, at('docType'), at('currency')]
      .filter(Boolean)
      .join(' ')
      .trim();

    // عمود مبلغ واحد (أو رصيد عند غياب المبلغ): تُستنتج الجهة من الإشارة وجهة الكشف
    if (!debitRaw && !creditRaw && amountRaw) {
      const value = amountOf(amountRaw);
      if (value !== null) ({ debitRaw, creditRaw } = amountToDebitCredit(value, side));
    }

    const dateParsedHere = parseDate(dateRaw, template.dateFormats);
    const parsedDebit = amountOf(debitRaw);
    const parsedCredit = amountOf(creditRaw);
    const parsedAmount = amountRaw ? amountOf(amountRaw) : null;
    const hasParsedAmount = parsedDebit !== null || parsedCredit !== null || parsedAmount !== null;

    // صف بلا تاريخ: إما رصيد/إجمالي، أو ترويسة مكررة، أو بيانات بلا تاريخ تحتاج تصحيحاً بشرياً.
    if (dateParsedHere === null) {
      const isSummary = TOTAL_ROW.test(description) || TOTAL_ROW.test(dateRaw) || SUMMARY_ANYWHERE.test(rowText);
      if (isSummary) {
        if (OPENING_ROW.test(rowText)) openingSeen = true;
        const bal = parsedAmount ??
          (col.balance != null ? amountOf(at('balance')) : null) ??
          parsedDebit ?? parsedCredit ??
          (dateRaw && amountOf(dateRaw) !== null ? amountOf(dateRaw) : null);
        if (bal !== null) {
          if (OPENING_ROW.test(rowText)) {
            if (opening === null) opening = bal;
          } else if (CLOSING_ROW.test(rowText)) {
            if (closingHint === null) closingHint = bal;
          } else if (opening === null && !openingSeen) {
            opening = bal;
          } else {
            genericClosing = bal;
          }
        }
        ignoredRows += 1;
        return;
      }
      // تاريخ نصي طويل غير قابل للتحليل = تذييل صفحة/تطبيق («تطبيق مدونة الحسابات») لا بند مالي
      if (dateRaw && /[A-Za-z\u0600-\u06FF]{3,}/.test(dateRaw)) {
        ignoredRows += 1;
        return;
      }
      // صف ترويسة مكررة داخل الجدول (كلماته أسماء أعمدة لا أرقام) — لا يُعرض كبند
      if (!hasParsedAmount && [dateRaw, debitRaw, creditRaw, amountRaw, description].some((value) => value && HEADER_WORD.test(value))) {
        ignoredRows += 1;
        return;
      }
      // صف بلا تاريخ وبلا أي مبلغ (أو بمبلغ صفري فقط) = ترويسة/زخرفة — لا فائدة من عرضه كبند
      const nonzeroAmount = [parsedDebit, parsedCredit, parsedAmount].some((value) => value !== null && value !== 0);
      if (!nonzeroAmount) {
        ignoredRows += 1;
        return;
      }
      // بقي: مبلغ بلا تاريخ — يُعرض للمستخدم ليصحح تاريخه بدل إسقاطه بصمت
    } else if (TOTAL_ROW.test(description) && !docNo && !ref) {
      // صف «الإجمالي/المجموع» بتاريخ: يظهر في بعض الأنظمة كسطر ختامي — يُقرأ كرصيد لا كبند
      const bal = parsedAmount ?? parsedDebit ?? parsedCredit;
      if (bal !== null) {
        if (opening === null) opening = bal;
        else genericClosing = bal;
      }
      ignoredRows += 1;
      return;
    }

    if (col.balance != null) {
      const balanceValue = amountOf(at('balance'));
      if (balanceValue !== null) lastBalance = balanceValue;
    }

    lines.push({
      lineNo: lines.length + 1,
      dateRaw,
      docType: at('docType'),
      docNo,
      description,
      ref,
      debitRaw,
      creditRaw,
    });
  });

  if (lines.length === 0) {
    throw ERR.VALIDATION([
      { field: 'file', messageAr: 'لم يُستخرج أي بند — تأكد من تعيين أعمدة التاريخ والبيان والمبلغ مع ترتيب الملف وعدد صفوف الترويسة' },
    ]);
  }
  if (closingHint === null) closingHint = genericClosing ?? lastBalance;
  return { lines, opening, closingHint, ignoredRows };
}

export function parseStatementFile(
  buffer: Buffer,
  filename: string,
  template: TemplateMapping,
  side: StatementSide = 'theirs',
  sheetName?: string | null,
): ParseResult {
  const { sheets } = readStatementWorkbook(buffer, filename);

  const col = {} as Record<FieldKey, number | null>;
  for (const key of FIELD_KEYS) {
    const letter = template.columnsMapping[key];
    col[key] = letter ? columnIndex(letter) : null;
  }
  if (col.date == null) {
    throw ERR.VALIDATION([{ field: 'template', messageAr: 'القالب لا يحدد عمود التاريخ (date) — عدّل تعيين الأعمدة' }]);
  }
  const numericColumns = [col.debit, col.credit, col.amount, col.balance]
    .filter((index): index is number => index !== null);

  // اختيار الورقة: طلب المستخدم أولاً، ثم الورقة الوحيدة التي فيها بنود فعلية
  const requested = sheetName?.trim();
  let selected: WorkbookSheet | undefined;
  if (requested) {
    selected = sheets.find((sheet) => sheet.name === requested)
      ?? sheets.find((sheet) => sheet.name.trim().toLowerCase() === requested.toLowerCase());
    if (!selected) {
      throw ERR.VALIDATION([{ field: 'sheetName', messageAr: `الورقة «${requested}» غير موجودة — المتاح: ${sheets.map((sheet) => sheet.name).join('، ')}` }]);
    }
  } else {
    // الورقة المخفية غالباً قالب/مراجع؛ لا تسبب «معاملات في عدة أوراق» ما دامت
    // هناك ورقة ظاهرة. إن كانت كل الأوراق مخفية نعود إليها كلها.
    const visible = sheets.filter((sheet) => !sheet.hidden);
    const autoSheets = visible.length ? visible : sheets;
    const candidates = autoSheets.filter((sheet) => sheet.rows.slice(template.headerRows).some((row) =>
      parseDate(row[col.date!], template.dateFormats) !== null &&
      numericColumns.some((index) => parseAmount(CELL(row[index]), template.decimalSep, template.thousandSep) !== null)));
    if (candidates.length > 1) {
      throw ERR.VALIDATION([{ field: 'file', messageAr: `توجد معاملات في عدة أوراق (${candidates.map((sheet) => sheet.name).join('، ')}) — اختر الورقة المطلوبة من لوحة التعيين حتى لا تُهمل بنوداً` }]);
    }
    selected = candidates[0] ?? autoSheets[0] ?? sheets[0];
  }
  const rows = selected?.rows ?? [];
  const selectedName = selected?.name ?? '';
  if (!rows.length) {
    throw ERR.VALIDATION([{ field: 'file', messageAr: 'الملف فارغ — لا صفوف فيه' }]);
  }

  const parsed = parseStatementRows(rows, template, side);
  return { ...parsed, sheetName: selectedName, sheetNames: sheets.map((sheet) => sheet.name) };
}
