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
}

export interface WorkbookSheet {
  name: string;
  rows: unknown[][];
}

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

const CURRENCY_NOISE = /(?:YER|USD|SAR|ر\.?ي\.?|ر\.?س\.?|\$|﷼|ريال|دولار)/gi;
const normalizeNumerals = (text: string, decimalSep: string, thousandSep: string): string => text
  .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
  .replace(/\u066b/g, decimalSep)
  .replace(/\u066c/g, thousandSep);

/** نص خام → رقم حسب فواصل القالب — يرجع null لو لا يُحلَّل */
export function parseAmount(raw: string, decimalSep: string, thousandSep: string): number | null {
  const value = normalizeNumerals(String(raw ?? '').replace(CURRENCY_NOISE, '').trim(), decimalSep, thousandSep);
  if (!value || value === '—' || value === '-') return null;
  if (!['.', ','].includes(decimalSep) || !['.', ','].includes(thousandSep) || decimalSep === thousandSep) return null;
  const decimal = decimalSep === '.' ? '\\.' : ',';
  const thousands = thousandSep === '.' ? '\\.' : ',';
  const format = new RegExp(`^-?(?:\\d{1,3}(?:${thousands}\\d{3})+|\\d+)(?:${decimal}\\d{1,4})?$`);
  if (!format.test(value)) return null;
  const amount = Number(value.split(thousandSep).join('').replace(decimalSep, '.'));
  return Number.isFinite(amount) ? amount : null;
}

/** تنسيق تاريخ JS → YYYY-MM-DD */
function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** نص/تاريخ Excel → YYYY-MM-DD حسب صيغ القالب — null لو فشل */
export function parseDate(raw: unknown, formats: string[]): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return isoDate(raw);
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    // رقم تسلسلي Excel (منذ 1899-12-30)
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    return isoDate(new Date(ms));
  }
  const s = normalizeNumerals(String(raw ?? '').trim(), '.', ',');
  if (!s) return null;
  const segments = s.split(/[/\-.]/).map((x) => x.trim());

  /** محاولة صيغة واحدة — lenient: YYYY يقبل سنة قصيرة (26→2026) بعد فشل الصارم */
  const tryFormat = (fmt: string, lenient = false): string | null => {
    const parts = fmt.split(/[/\-.]/).map((x) => x.trim().toUpperCase());
    if (parts.length !== segments.length) return null;
    const get = (token: string): number | null => {
      const i = parts.indexOf(token);
      if (i < 0) return null;
      const seg = segments[i];
      // الصرامة تمنع 2030 بدل 2026: YYYY الصارم يلزمه 4 أرقام بالضبط
      if (!lenient && token === 'YYYY' && seg.length !== 4) return null;
      const n = Number(seg);
      return Number.isInteger(n) ? n : null;
    };
    let year = get('YYYY');
    const month = get('MM');
    const day = get('DD');
    if (year === null || month === null || day === null) return null;
    if (year < 100) year += 2000;
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (month >= 1 && month <= 12 && day >= 1 && year > 1990 && year < 2100 &&
        calendarDate.getUTCFullYear() === year && calendarDate.getUTCMonth() === month - 1 && calendarDate.getUTCDate() === day) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
  };

  for (const fmt of formats) {
    const strict = tryFormat(fmt);
    if (strict) return strict;
  }
  // التمريرة المتساهلة (سنة قصيرة): صيغ «يوم-أولاً» مقدَّمة — العرف المحلي DD/MM
  // يتفوق على قراءة سنة-أولاً حين يكون التفسيران متاحين (30-06-26 = 2026-06-30 لا 2030)
  const dayFirst = formats.filter((f) => !f.trim().toUpperCase().startsWith('YYYY'));
  const yearFirst = formats.filter((f) => f.trim().toUpperCase().startsWith('YYYY'));
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
    try {
      const content = new TextDecoder(utf16le ? 'utf-16le' : utf16be ? 'utf-16be' : 'utf-8', { fatal: true }).decode(buffer);
      if (!/[\u0000-\u0008\u000e-\u001f]/.test(content)) csvContent = content.replace(/^\ufeff/, '');
    } catch {
      csvContent = null;
    }
  }
  if ((ext === 'xlsx' && !isXlsx) || (ext === 'xls' && !isXls) || (ext === 'csv' && csvContent === null)) {
    throw ERR.VALIDATION([{ field: 'file', messageAr: 'امتداد الملف لا يطابق محتواه أو ترميز CSV ليس UTF-8/UTF-16 — أعد تصديره بالصيغة الصحيحة' }]);
  }

  try {
    const wb = ext === 'csv'
      // raw: true — لا يُحوّل CSV النص إلى أرقام/تواريخ، فنحفظ النص الخام (فواصل/أرقام عربية) للتحليل والتصحيح
      ? XLSX.read(csvContent!, { type: 'string', cellDates: true, raw: true })
      : XLSX.read(buffer, { cellDates: true });
    const sheets = wb.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false, defval: '' }),
    }));
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

export function parseStatementFile(
  buffer: Buffer,
  filename: string,
  template: TemplateMapping,
  side: StatementSide = 'theirs',
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
  const amountKey: FieldKey | null = col.amount != null ? 'amount' : col.balance != null ? 'balance' : null;
  const numericColumns = [col.debit, col.credit, col.amount, col.balance]
    .filter((index): index is number => index !== null);

  const candidates = sheets.filter((sheet) => sheet.rows.slice(template.headerRows).some((row) =>
    parseDate(row[col.date!], template.dateFormats) !== null &&
    numericColumns.some((index) => parseAmount(CELL(row[index]), template.decimalSep, template.thousandSep) !== null)));
  if (candidates.length > 1) {
    throw ERR.VALIDATION([{ field: 'file', messageAr: `توجد معاملات في عدة أوراق (${candidates.map((sheet) => sheet.name).join('، ')}) — صدّر الورقة المطلوبة وحدها حتى لا تُهمل بنوداً` }]);
  }
  const selected = candidates[0] ?? sheets[0];
  const rows = selected?.rows ?? [];
  const sheetName = selected?.name ?? '';
  if (!rows.length) {
    throw ERR.VALIDATION([{ field: 'file', messageAr: 'الملف فارغ — لا صفوف فيه' }]);
  }

  const lines: RawLine[] = [];
  let opening: number | null = null;
  let closingHint: number | null = null;
  const amountOf = (v: unknown) => parseAmount(CELL(v), template.decimalSep, template.thousandSep);

  // تخطي صفوف الترويسة المعرفة بالقالب (headerRows) — ثم فحص الأرصدة والبنود
  rows.slice(template.headerRows).forEach((row) => {
    const at = (key: FieldKey): string => {
      const idx = col[key];
      return idx == null || row[idx] === undefined ? '' : CELL(row[idx]);
    };
    const dateRaw = at('date');
    const amountRaw = amountKey ? at(amountKey) : '';
    let debitRaw = at('debit');
    let creditRaw = at('credit');
    const description = at('description');

    // عمود مبلغ واحد (أو رصيد عند غياب المبلغ): تُستنتج الجهة من الإشارة وجهة الكشف
    if (!debitRaw && !creditRaw && amountRaw) {
      const value = amountOf(amountRaw);
      if (value !== null) ({ debitRaw, creditRaw } = amountToDebitCredit(value, side));
    }

    // صف أرصدة/مجاميع الترويسة: تاريخ غير قابل للتحليل + كلمة رصيد/افتتاحي/إجمالي/نهائي = افتتاحي ثم ختامي.
    // (مكان الكلمة يختلف بين الملفات: عمود التاريخ أو البيان)
    const balanceText = `${dateRaw} ${description}`;
    const dateParsedHere = parseDate(dateRaw, template.dateFormats);
    if (dateParsedHere === null && /(رصيد|فتتاحي|افتتاحي|إجمالي|اجمالي|مجموع|نهائي|ختامي)/.test(balanceText)) {
      const bal = amountOf(debitRaw) ?? amountOf(creditRaw) ?? (amountRaw ? amountOf(amountRaw) : null);
      if (bal !== null) {
        if (opening === null) opening = bal;
        else closingHint = bal;
      }
      return; // صف رصيد بلا مبلغ = زخرفة ترويسة — يُتخطى
    }

    // تخطي الصفوف الفارغة فعلياً (بلا تاريخ وبلا مبالغ) — مثل رؤوس الأعمدة المكررة
    if (!dateRaw && !debitRaw && !creditRaw && !amountRaw) return;

    lines.push({
      lineNo: lines.length + 1,
      dateRaw,
      docType: at('docType'),
      docNo: at('docNo'),
      description,
      ref: at('ref'),
      debitRaw,
      creditRaw,
    });
  });

  if (lines.length === 0) {
    throw ERR.VALIDATION([
      { field: 'file', messageAr: 'لم يُستخرج أي بند — تأكد من تعيين أعمدة التاريخ والبيان والمبلغ مع ترتيب الملف وعدد صفوف الترويسة' },
    ]);
  }
  return { lines, opening, closingHint, sheetName };
}
