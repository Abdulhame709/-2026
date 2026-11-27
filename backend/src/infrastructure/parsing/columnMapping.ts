import {
  CELL,
  columnLetter,
  parseAmount,
  parseDate,
  type FieldKey,
  type WorkbookSheet,
} from './statementParser.js';

/**
 * التعرّف على أعمدة الكشوف (2026-11-27):
 * يقرأ صف الترويسة ويطابق أسماء الأعمدة العربية/الإنجليزية بمرادفات، ثم يكمل الناقص
 * بفحص المحتوى (تواريخ/مبالغ/نصوص). النتيجة اقتراح فقط — المستخدم يصحّحه من القائمة المنسدلة
 * ويُحفظ كقالب قابل لإعادة الاستخدام.
 */

export interface DetectedColumn {
  index: number;
  letter: string;
  header: string;
  sample: string[];
  field: FieldKey | null;
}

export interface ColumnDetection {
  headerRowIndex: number;
  headerRows: number;
  columns: DetectedColumn[];
  mapping: Partial<Record<FieldKey, string>>;
  decimalSep: '.' | ',';
  thousandSep: ',' | '.';
  /** ترتيب صيغ التاريخ المقترح لهذا الملف (الأرجح أولاً) — يمرَّر للتحليل والاعتماد */
  dateFormats: string[];
  warnings: string[];
}

const DATE_FORMATS = [
  'YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY/MM/DD', 'DD.MM.YYYY',
  'MM/DD/YYYY', 'DD/MM/YY', 'DD-MM-YY', 'YYYYMMDD',
];

/** ترتيب اليوم/الشهر من قيم عمود التاريخ: 13/04 ⇒ يوم أول، 04/13 ⇒ شهر أول */
function suggestDateFormat(values: string[]): string | null {
  let dayFirst = 0;
  let monthFirst = 0;
  let yearFirst = 0;
  for (const raw of values) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    if (/^\d{8}$/.test(text)) { yearFirst += 2; continue; }
    const parts = text.split(/[/\-.]/).map((part) => part.trim());
    if (parts.length !== 3 || parts.some((part) => !/^\d{1,4}$/.test(part))) continue;
    if (parts[0].length === 4) { yearFirst += 1; continue; }
    if (Number(parts[0]) > 12) dayFirst += 1;
    else if (Number(parts[1]) > 12) monthFirst += 1;
  }
  if (yearFirst > dayFirst && yearFirst > monthFirst) return 'YYYY-MM-DD';
  if (dayFirst > monthFirst) return 'DD/MM/YYYY';
  if (monthFirst > dayFirst) return 'MM/DD/YYYY';
  return null;
}

/** توحيد نص الترويسة: تشكيل/تطويل/علامات اتجاه + أ/إ/آ→ا، ى→ي، ة→ه */
export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u064b-\u065f\u0670\u0640\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

/** مرادفات الترويسات — تُطبَّع عند التحميل */
const SYNONYMS: Array<{ field: FieldKey; words: string[] }> = [
  { field: 'date', words: ['تاريخ', 'التاريخ', 'تاريخ العمليه', 'تاريخ القيد', 'تاريخ الفاتوره', 'تاريخ المستند', 'تاريخ السند', 'date', 'value date', 'posting date', 'transaction date', 'day'] },
  { field: 'docType', words: ['نوع المستند', 'نوع العمليه', 'نوع الحركه', 'نوع الحركة', 'نوع', 'type', 'document type', 'doc type', 'transaction type'] },
  { field: 'docNo', words: ['رقم المستند', 'رقم الفاتوره', 'رقم القيد', 'رقم السند', 'رقم العمليه', 'رقم الحركة', 'رقم الاشعار', 'الرقم', 'رقم', 'doc no', 'document no', 'document number', 'invoice no', 'invoice number', 'voucher no', 'entry no', 'no', 'number', 'id'] },
  { field: 'description', words: ['البيان', 'بيان', 'الوصف', 'وصف', 'التفاصيل', 'تفاصيل', 'الشرح', 'شرح', 'الملاحظات', 'ملاحظات', 'التوصيف', 'توصيف', 'description', 'details', 'narration', 'particulars', 'memo', 'notes'] },
  { field: 'ref', words: ['المرجع', 'مرجع', 'المرجع الخارجي', 'مرجع خارجي', 'reference', 'ref', 'external ref', 'external reference'] },
  { field: 'debit', words: ['مدين', 'المدين', 'مدينه', 'عليه', 'debit', 'dr'] },
  { field: 'credit', words: ['دائن', 'الدائن', 'دائنه', 'له', 'credit', 'cr'] },
  { field: 'amount', words: ['المبلغ', 'مبلغ', 'القيمه', 'قيمه', 'صافي', 'الصافي', 'الحركه', 'حركه', 'مدين/دائن', 'مدين / دائن', 'مدين ودائن', 'debit/credit', 'debit / credit', 'amount', 'value', 'net amount', 'net'] },
  { field: 'balance', words: ['الرصيد', 'رصيد', 'الرصيد التراكمي', 'الرصيد بعد الحركة', 'balance', 'running balance'] },
  { field: 'currency', words: ['العملة', 'عمله', 'currency', 'ccy', 'curr'] },
];

const NORMALIZED_SYNONYMS = SYNONYMS.map(({ field, words }) => ({
  field,
  words: words.map(normalizeHeader),
}));

const FIELD_PRIORITY: FieldKey[] = [
  'date',
  'description',
  'debit',
  'credit',
  'amount',
  'balance',
  'ref',
  'docNo',
  'docType',
  'currency',
];

/** أفضل مطابقة ترويسة لعمود واحد — null لو لا مطابقة */
function matchHeader(header: string): { field: FieldKey; score: number } | null {
  if (!header) return null;
  const padded = ` ${header} `;
  let best: { field: FieldKey; score: number } | null = null;
  for (const { field, words } of NORMALIZED_SYNONYMS) {
    for (const word of words) {
      if (!word) continue;
      let score = 0;
      if (header === word) score = 1000 + word.length;
      else if (padded.includes(` ${word} `)) score = 100 + word.length;
      else if (header.startsWith(word) || header.endsWith(word)) score = 10 + word.length;
      if (score > 0 && (!best || score > best.score)) best = { field, score };
    }
  }
  return best;
}

/** صف الترويسة: أعلى صف يحمل أكبر عدد من الحقول المعروفة (2 على الأقل) */
function findHeaderRow(rows: unknown[][]): { index: number; fields: number } {
  let best = { index: 0, fields: 0, nonEmpty: 0 };
  const limit = Math.min(rows.length, 15);
  for (let i = 0; i < limit; i += 1) {
    const seen = new Set<FieldKey>();
    let nonEmpty = 0;
    for (const cell of rows[i]) {
      const text = CELL(cell);
      if (text) nonEmpty += 1;
      const match = matchHeader(normalizeHeader(text));
      if (match) seen.add(match.field);
    }
    if (seen.size >= 2 && (seen.size > best.fields || (seen.size === best.fields && nonEmpty > best.nonEmpty))) {
      best = { index: i, fields: seen.size, nonEmpty };
    }
  }
  return best;
}

function detectSeparators(samples: string[]): { decimalSep: '.' | ','; thousandSep: ',' | '.' } {
  let dotThousands = 0;
  let commaThousands = 0;
  for (const raw of samples) {
    const value = raw.replace(/[^\d.,-]/g, '');
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(value)) dotThousands += 1;
    else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) commaThousands += 1;
  }
  return commaThousands > dotThousands
    ? { decimalSep: ',', thousandSep: '.' }
    : { decimalSep: '.', thousandSep: ',' };
}

function parseAmountEither(raw: string, decimalSep: string, thousandSep: string): number | null {
  return parseAmount(raw, decimalSep, thousandSep) ?? parseAmount(raw, '.', ',') ?? parseAmount(raw, ',', '.');
}

const SUMMARY_ROW = /^(?:ال)?(?:رصيد|اجمالي|إجمالي|مجموع|نهائي|ختامي|total|balance|closing|opening)(?=$|[\s:\-–—])/i;

/** صف رصيد/إجمالي بلا تاريخ — يُستبعد من إحصاءات المحتوى كي لا يُختار عمود الرصيد كمبلغ */
function isSummaryRow(row: unknown[]): boolean {
  if (row.some((cell) => parseDate(cell, DATE_FORMATS) !== null)) return false;
  return row.some((cell) => SUMMARY_ROW.test(CELL(cell)));
}

/** صف ترويسة إضافي (ترويسة على صفين/خلايا مدمجة): نصوص معروفة بلا تواريخ ولا مبالغ */
function isHeaderContinuation(row: unknown[]): boolean {
  let known = 0;
  let nonEmpty = 0;
  for (const cell of row) {
    const text = CELL(cell);
    if (!text) continue;
    nonEmpty += 1;
    if (parseDate(text, DATE_FORMATS) !== null) return false;
    if (parseAmountEither(text, '.', ',')) return false;
    if (matchHeader(normalizeHeader(text))) known += 1;
  }
  return nonEmpty > 0 && known > 0;
}

/** فحص المحتوى يكمل الترويسات الناقصة أو الغامضة */
function detectFromContent(
  columns: DetectedColumn[],
  dataRows: unknown[][],
  mapping: Partial<Record<FieldKey, string>>,
): void {
  const rows = dataRows.slice(0, 12).filter((row) => row.some((cell) => CELL(cell) !== '') && !isSummaryRow(row));
  if (!rows.length) return;
  const stats = columns.map((column) => {
    let dates = 0;
    let amounts = 0;
    let texts = 0;
    let textLength = 0;
    for (const row of rows) {
      const value = CELL(row[column.index]);
      if (!value) continue;
      if (parseDate(value, DATE_FORMATS)) dates += 1;
      else if (parseAmountEither(value, '.', ',')) amounts += 1;
      else if (value.length >= 3) {
        texts += 1;
        textLength += value.length;
      }
    }
    return { column, dates, amounts, texts, avgText: texts ? textLength / texts : 0 };
  });
  const free = () => stats.filter((item) => !item.column.field);
  const ratio = (count: number) => count / rows.length;

  if (!mapping.date) {
    const candidate = free().sort((a, b) => b.dates - a.dates)[0];
    if (candidate && ratio(candidate.dates) >= 0.6) {
      candidate.column.field = 'date';
      mapping.date = candidate.column.letter;
    }
  }
  if (!mapping.description) {
    const candidate = free().sort((a, b) => (b.texts - a.texts) || (b.avgText - a.avgText))[0];
    if (candidate && ratio(candidate.texts) >= 0.5) {
      candidate.column.field = 'description';
      mapping.description = candidate.column.letter;
    }
  }
  const hasAmount = mapping.debit || mapping.credit || mapping.amount || mapping.balance;
  if (!hasAmount) {
    const numeric = free()
      .filter((item) => ratio(item.amounts) >= 0.7)
      .sort((a, b) => b.amounts - a.amounts);
    if (numeric.length === 1) {
      numeric[0].column.field = 'amount';
      mapping.amount = numeric[0].column.letter;
    }
  }
}

/** التعرّف الكامل على أعمدة ورقة واحدة */
export function detectColumnMapping(rows: unknown[][]): ColumnDetection {
  const header = findHeaderRow(rows);
  const headerRowIndex = header.fields >= 2 ? header.index : -1;
  let headerRows = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;
  // ترويسة على أكثر من صف: صف فرعي مثل «مدين | دائن» تحت «المبلغ» — يُضاف للترويسة
  if (headerRowIndex >= 0) {
    while (headerRows < rows.length && headerRows <= headerRowIndex + 3 && isHeaderContinuation(rows[headerRows])) {
      headerRows += 1;
    }
  }
  const dataStart = headerRows;

  // نص الترويسة لكل عمود: آخر صف ترويسة غير فارغ (الصف الفرعي أدق من الأصل)
  const headerTextAt = (index: number): string => {
    if (headerRowIndex < 0) return '';
    for (let rowIndex = headerRows - 1; rowIndex >= headerRowIndex; rowIndex -= 1) {
      const text = CELL(rows[rowIndex]?.[index]);
      if (text) return text;
    }
    return '';
  };

  let width = 0;
  for (const row of rows.slice(headerRows, headerRows + 8)) width = Math.max(width, row.length);
  width = Math.min(width, 40);

  const columns: DetectedColumn[] = [];
  for (let index = 0; index < width; index += 1) {
    const headerText = headerTextAt(index);
    const sample: string[] = [];
    for (const row of rows.slice(dataStart, dataStart + 10)) {
      const value = CELL(row[index]);
      if (value) sample.push(value.length > 40 ? `${value.slice(0, 40)}…` : value);
      if (sample.length >= 3) break;
    }
    if (!headerText && sample.length === 0) continue;
    columns.push({ index, letter: columnLetter(index), header: headerText, sample, field: null });
  }

  // مطابقة الترويسات: أعلى الدرجات أولاً، وكل حقل/عمود يُستخدم مرة واحدة
  const scored: Array<{ column: DetectedColumn; field: FieldKey; score: number }> = [];
  for (const column of columns) {
    const match = matchHeader(normalizeHeader(column.header));
    if (match) scored.push({ column, field: match.field, score: match.score });
  }
  scored.sort((a, b) => b.score - a.score || FIELD_PRIORITY.indexOf(a.field) - FIELD_PRIORITY.indexOf(b.field) || a.column.index - b.column.index);
  const mapping: Partial<Record<FieldKey, string>> = {};
  for (const item of scored) {
    if (item.column.field || mapping[item.field]) continue;
    item.column.field = item.field;
    mapping[item.field] = item.column.letter;
  }

  detectFromContent(columns, rows.slice(dataStart), mapping);

  const numericSamples = columns
    .filter((column) => column.field === 'debit' || column.field === 'credit' || column.field === 'amount' || column.field === 'balance')
    .flatMap((column) => column.sample);
  const { decimalSep, thousandSep } = detectSeparators(numericSamples);

  const dateColumn = columns.find((column) => column.field === 'date');
  const dateSamples = dateColumn
    ? rows.slice(dataStart, dataStart + 60).map((row) => CELL(row[dateColumn.index])).filter(Boolean)
    : [];
  const suggestedFormat = suggestDateFormat(dateSamples);
  const dateFormats = suggestedFormat
    ? [suggestedFormat, ...DATE_FORMATS.filter((format) => format !== suggestedFormat)]
    : [...DATE_FORMATS];

  const warnings: string[] = [];
  if (header.fields < 2) {
    warnings.push('لم يُعثر على صف ترويسة واضح — عيّن الأعمدة يدوياً من القائمة المنسدلة');
  }
  if (!mapping.date) warnings.push('لم يُعثر على عمود التاريخ — عيّنه يدوياً');
  if (!mapping.debit && !mapping.credit && !mapping.amount && !mapping.balance) {
    warnings.push('لم يُعثر على عمود مبلغ — عيّن مدين/دائن أو المبلغ يدوياً');
  }
  if (mapping.balance) {
    warnings.push('عمود «الرصيد» سيُعامل كمبلغ حركة عند غياب عمود مبلغ — راجعه قبل الاعتماد');
  }
  if (mapping.currency) {
    warnings.push('عمود العملة لن يُستخدم — المطابقة تجري بعملة حساب المورد');
  }
  if (mapping.amount || mapping.balance) {
    warnings.push('عند وجود عمود مبلغ واحد: القيمة الموجبة دائن في «كشفنا» ومدين في «كشف المورد»، والسالب عكس ذلك — راجع الاتجاه في المعاينة');
  }

  return { headerRowIndex, headerRows, columns, mapping, decimalSep, thousandSep, dateFormats, warnings };
}

/** اختيار ورقة المعاملات من مصنف متعدد الأوراق (أعلى عدد صفوف فيها تواريخ) */
export function pickStatementSheet(sheets: WorkbookSheet[]): { sheet: WorkbookSheet; ambiguousSheets: string[] } {
  const scored = sheets.map((sheet) => ({
    sheet,
    score: sheet.rows.slice(0, 40).reduce(
      (total, row) => total + (row.some((cell) => parseDate(cell, DATE_FORMATS) !== null) ? 1 : 0),
      0,
    ),
  }));
  const max = Math.max(0, ...scored.map((item) => item.score));
  if (max === 0) return { sheet: sheets[0], ambiguousSheets: [] };
  const ambiguousSheets = scored.filter((item) => item.score > 0).map((item) => item.sheet.name);
  return { sheet: scored.find((item) => item.score === max)!.sheet, ambiguousSheets };
}
