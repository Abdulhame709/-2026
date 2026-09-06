import * as XLSX from 'xlsx';
import { ERR } from '../../domain/errors.js';

/**
 * محلل الكشوفات — Excel/CSV (Module 3).
 * الفلسفة: نستخرج النص الخام كما هو (dateRaw/debitRaw…) — التصحيح البشري على الخام
 * في المعاينة (FR-3.3) والتحويل النهائي للأرقام/التواريخ عند الاعتماد فقط.
 * PDF الرقمي/الممسوح: مسار OCR منفصل (D5) — هنا رسالة واضحة بدل فشل صامت.
 */

export interface TemplateMapping {
  headerRows: number;
  columnsMapping: Record<string, string>; // date/docType/docNo/description/ref/debit/credit → حرف عمود
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
}

export interface ParseResult {
  lines: RawLine[];
  opening: number | null; // رصيد افتتاحي مكتشف من الترويسة (أفضل جهد)
  closingHint: number | null;
}

const FIELD_KEYS = ['date', 'docType', 'docNo', 'description', 'ref', 'debit', 'credit'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

/** حرف عمود Excel (A=0…) → رقم */
function colIndex(letter: string): number | null {
  const m = /^[A-Za-z]{1,2}$/.exec(letter.trim());
  if (!m) return null;
  let idx = 0;
  for (const ch of letter.toUpperCase()) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
}

const CURRENCY_NOISE = /(?:YER|USD|SAR|ر\.?ي\.?|ر\.?س\.?|\$|﷼|ريال|دولار)/gi;

/** نص خام → رقم حسب فواصل القالب — يرجع null لو لا يُحلَّل */
export function parseAmount(raw: string, decimalSep: string, thousandSep: string): number | null {
  let s = String(raw ?? '').replace(CURRENCY_NOISE, '').trim();
  if (!s || s === '—' || s === '-') return null;
  s = s.split(thousandSep).join('').replace(',', '').trim(); // الآلاف دائماً تُزال
  if (decimalSep !== '.') s = s.replace(decimalSep, '.');
  if (/^-?\d*\.?\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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
  const s = String(raw ?? '').trim();
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
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year > 1990 && year < 2100) {
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

const CELL = (v: unknown): string =>
  v instanceof Date ? isoDate(v) : String(v ?? '').trim();

export function parseStatementFile(
  buffer: Buffer,
  filename: string,
  template: TemplateMapping,
): ParseResult {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') {
    throw ERR.VALIDATION([
      { field: 'file', messageAr: 'مسار PDF (الرقمي والممسوح عبر OCR) يُفعَّل في الخطوة التالية من الخطة — استخدم Excel/CSV الآن أو الإدخال اليدوي بعد تدقيق OCR' },
    ]);
  }
  if (!['xlsx', 'xls', 'csv'].includes(ext)) {
    throw ERR.VALIDATION([{ field: 'file', messageAr: 'صيغة غير مدعومة — المسموح: xlsx / xls / csv (وPDF لاحقاً عبر OCR)' }]);
  }

  let rows: unknown[][];
  try {
    const wb = XLSX.read(buffer, { cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' });
  } catch {
    throw ERR.VALIDATION([{ field: 'file', messageAr: 'تعذر قراءة الملف — تأكد أنه Excel/CSV سليم' }]);
  }
  if (!rows.length) {
    throw ERR.VALIDATION([{ field: 'file', messageAr: 'الملف فارغ — لا صفوف فيه' }]);
  }

  // خرائط الأعمدة من القالب
  const col = {} as Record<FieldKey, number | null>;
  for (const key of FIELD_KEYS) {
    const letter = template.columnsMapping[key];
    col[key] = letter ? colIndex(letter) : null;
  }
  if (col.date == null) {
    throw ERR.VALIDATION([{ field: 'template', messageAr: 'القالب لا يحدد عمود التاريخ (date) — عدّل تعيين الأعمدة' }]);
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
    const debitRaw = at('debit');
    const creditRaw = at('credit');
    const description = at('description');

    // صف أرصدة الترويسة: تاريخ غير قابل للتحليل + كلمة «رصيد» في أي نص + مبلغ = افتتاحي ثم ختامي.
    // (مكان كلمة رصيد يختلف بين الملفات: عمود التاريخ أو البيان)
    const balanceText = `${dateRaw} ${description}`;
    const dateParsedHere = parseDate(dateRaw, template.dateFormats);
    if (dateParsedHere === null && /رصيد/.test(balanceText)) {
      const bal = amountOf(debitRaw) ?? amountOf(creditRaw);
      if (bal !== null) {
        if (opening === null) opening = bal;
        else closingHint = bal;
      }
      return; // صف رصيد بلا مبلغ = زخرفة ترويسة — يُتخطى
    }

    // تخطي الصفوف الفارغة فعلياً (بلا تاريخ وبلا مبالغ) — مثل رؤوس الأعمدة المكررة
    if (!dateRaw && !debitRaw && !creditRaw) return;

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
      { field: 'file', messageAr: 'لم يُستخرج أي بند — تأكد من تطابق أعمدة القالب مع ترتيب الملف وعدد صفوف الترويسة' },
    ]);
  }
  return { lines, opening, closingHint };
}
