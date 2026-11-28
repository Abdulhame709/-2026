import { parseAmount, parseDate, type FieldKey } from './statementParser.js';
import { matchHeader, normalizeHeader } from './columnMapping.js';

/**
 * إعادة بناء جداول PDF من إحداثيات النص (2026-11-28):
 * pdfjs يعطي كل مقطع نصي موضعه (x,y) وعرضه، لا صفوفاً. الاعتماد على ترتيب
 * الاستخراج أو على سطر واحد لكل عنصر يُزيح الأعمدة (الرصيد/رقم المستند/التاريخ
 * تُقرأ كمبالغ). هنا نبني الشبكة فعلياً:
 *   1) تطبيع NFKC (يحوّل صور الحروف العربية التقديمية) + أرقام هندية + إزالة
 *      علامات الاتجاه والتطويل.
 *   2) تجميع المقاطع في صفوف بصرية حسب y بتسامح يتناسب مع حجم الخط.
 *   3) تعلّم الأعمدة من صف/صفّي الترويسة (مرادفات matchHeader) + كل عنصر ترويسة
 *      ليُلتقط عمود الكمية/الرقم غير المسمّى.
 *   4) إسناد كل مقطع لأقرب عمود، وبناء خلية حسب نوع العمود (تاريخ/رقم/نص)،
 *      مع نزع العلامات الصغيرة الملتصقة كأرقام الصفوف.
 *   5) دمج أجزاء التاريخ المقسوم («2025-01-» + «01») وأسطر الوصف المكمّلة.
 * الناتج شبكة صفوف جاهزة لـ detectColumnMapping ثم parseStatementRows — نفس
 * منطق Excel/CSV تماماً (افتتاحي/ختامي/مجاميع/جهة الكشف).
 */

export interface PdfTextItem {
  str?: string;
  transform: number[];
  width?: number;
  height?: number;
}

export interface PdfColumnAnchor {
  /** مركز العمود الأفقي (نقطة) */
  x: number;
  /** حدّ العمود الأيمن (نقطة) — يُستخدم لمحاذاة النص العربي RTL */
  right: number;
  /** نص الترويسة الأقرب */
  header: string;
  /** الحقل المكتشف من الترويسة — null لعمود غير مسمّى (كمية/تسلسل) */
  field: FieldKey | null;
}

export interface PdfLayout {
  anchors: PdfColumnAnchor[];
  /** عدد صفوف الترويسة من أعلى الشبكة — 0 عند إعادة استخدام تخطيط صفحة سابقة */
  headerRows: number;
}

export interface PdfTable {
  rows: unknown[][];
  layout: PdfLayout;
}

type CellType = 'text' | 'number' | 'date';

interface Word {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Row {
  y: number;
  words: Word[];
}

interface InternalAnchor extends PdfColumnAnchor {
  score: number;
  /** صف الترويسة الذي جاء منه رأس العمود (رئيسي أم فرعي) */
  row: number;
}

const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const NOISE = /^[.\-_|:=/\\]+$/;
const HEADER_SCAN_ROWS = 20;
const ANCHOR_MERGE = 14;
const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY/MM/DD', 'DD.MM.YYYY', 'MM/DD/YYYY'];

/** تطبيع نص PDF: صور الحروف → حروف قياسية، أرقام هندية → ASCII، بلا اتجاه/تطويل */
export function normalizePdfText(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(BIDI, '')
    .replace(/\u0640/g, '')
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\u066b/g, '.')
    .replace(/\u066c/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDateAny(text: string): string | null {
  return parseDate(text, DATE_FORMATS);
}

function parseAmountAny(text: string): number | null {
  return parseAmount(text, '.', ',') ?? parseAmount(text, ',', '.');
}

function isHeaderLike(text: string): boolean {
  return matchHeader(normalizeHeader(text)) !== null;
}

/** استخراج الكلمات ذات الإحداثيات — تصفية الفراغ والعلامات المفردة فقط */
export function extractPdfWords(items: PdfTextItem[]): Word[] {
  const words: Word[] = [];
  for (const item of items) {
    const text = normalizePdfText(item.str);
    if (!text || NOISE.test(text)) continue;
    const x = Number(item.transform?.[4]);
    const y = Number(item.transform?.[5]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const rawHeight = Number(item.height) || Math.abs(Number(item.transform?.[3])) || 9;
    const width = Number(item.width) || Math.max(1, text.length * rawHeight * 0.45);
    words.push({ text, x, y, width, height: rawHeight });
  }
  return words;
}

/** تجميع المقاطع في صفوف بصرية — التسامح يتناسب مع حجم الخط (3–7 نقاط) */
export function groupPdfRows(words: Word[]): Row[] {
  const rows: Row[] = [];
  const sorted = [...words].sort((a, b) => b.y - a.y || a.x - b.x);
  for (const word of sorted) {
    const tolerance = Math.max(2.5, Math.min(7, word.height * 0.6));
    let target: Row | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const distance = Math.abs(row.y - word.y);
      if (distance <= tolerance && distance < best) {
        best = distance;
        target = row;
      }
    }
    if (target) {
      target.words.push(word);
      target.y = (target.y * (target.words.length - 1) + word.y) / target.words.length;
    } else {
      rows.push({ y: word.y, words: [word] });
    }
  }
  rows.sort((a, b) => b.y - a.y);
  for (const row of rows) row.words.sort((a, b) => a.x - b.x);
  return rows;
}

function headerMatches(row: Row): Array<{ word: Word; field: FieldKey; score: number }> {
  const matches: Array<{ word: Word; field: FieldKey; score: number }> = [];
  for (const word of row.words) {
    const match = matchHeader(normalizeHeader(word.text));
    if (match) matches.push({ word, field: match.field, score: match.score });
  }
  return matches;
}

function detectLayout(rows: Row[], prior?: PdfLayout | null): { layout: PdfLayout; mainIndex: number; lastHeader: number } | null {
  const matchesByRow = new Map<number, ReturnType<typeof headerMatches>>();
  let mainIndex = -1;
  let bestFields = 0;
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let index = 0; index < limit; index += 1) {
    const matches = headerMatches(rows[index]);
    matchesByRow.set(index, matches);
    const fields = new Set(matches.map((match) => match.field)).size;
    if (matches.length >= 2 && fields > bestFields) {
      bestFields = fields;
      mainIndex = index;
    }
  }

  if (mainIndex < 0) {
    if (prior?.anchors.length) return { layout: { anchors: prior.anchors, headerRows: 0 }, mainIndex: -1, lastHeader: -1 };
    return null;
  }

  // صف ترويسة فرعي (دائن/مدين تحت المبلغ) يلي الصف الرئيس ولا يحمل بيانات
  let lastHeader = mainIndex;
  for (let index = mainIndex + 1; index <= mainIndex + 2 && index < rows.length; index += 1) {
    const matches = matchesByRow.get(index) ?? headerMatches(rows[index]);
    const hasData = rows[index].words.some((word) => parseAmountAny(word.text) !== null || parseDateAny(word.text) !== null);
    if (matches.length >= 2 && !hasData) lastHeader = index;
    else break;
  }

  const anchors: InternalAnchor[] = [];
  for (let index = mainIndex; index <= lastHeader; index += 1) {
    for (const word of rows[index].words) {
      const match = matchHeader(normalizeHeader(word.text));
      const center = word.x + word.width / 2;
      const edge = word.x + word.width;
      const existing = anchors.find((anchor) => Math.abs(anchor.x - center) <= ANCHOR_MERGE);
      if (!existing) {
        anchors.push({ x: center, right: edge, header: word.text, field: match?.field ?? null, score: match?.score ?? 0, row: index });
        continue;
      }
      if (match && (!existing.field || match.score > existing.score)) {
        existing.field = match.field;
        existing.header = word.text;
        existing.score = match.score;
      } else if (word.text.length > existing.header.length) {
        existing.header = word.text;
      }
      existing.x = (existing.x + center) / 2;
      existing.right = Math.max(existing.right, edge);
    }
  }
  /**
   * ترويسة مجموعة مدمجة («المبلغ» فوق «دائن | مدين»): رأس العمود الرئيسي ليس
   * عمود بيانات — أرقامه تُسند للعمودين الفرعيين. لو بقي لسرق بعض القيم من
   * دائن/مدين فاختلّت المجاميع. نُسقطه فقط عندما يقع بين دائن ومدين فعليين.
   */
  const subAnchors = anchors.filter((anchor) => anchor.row > mainIndex);
  const hasChildDebit = subAnchors.some((anchor) => anchor.field === 'debit');
  const hasChildCredit = subAnchors.some((anchor) => anchor.field === 'credit');
  const groupHeaders = hasChildDebit && hasChildCredit
    ? anchors.filter((anchor) => anchor.row === mainIndex
      && anchor.field === 'amount'
      && subAnchors.some((sub) => sub.x < anchor.x)
      && subAnchors.some((sub) => sub.x > anchor.x))
    : [];
  const keptAnchors = groupHeaders.length ? anchors.filter((anchor) => !groupHeaders.includes(anchor)) : anchors;

  keptAnchors.sort((a, b) => a.x - b.x);

  if (keptAnchors.length < 2) {
    if (prior?.anchors.length) return { layout: { anchors: prior.anchors, headerRows: 0 }, mainIndex, lastHeader };
    return null;
  }

  return {
    layout: {
      anchors: keptAnchors.map(({ x, right, header, field }) => ({ x, right, header, field })),
      headerRows: lastHeader + 1,
    },
    mainIndex,
    lastHeader,
  };
}

/** هل الترويسات عربية؟ (النص العربي يُحاذى ليمين خلاياه) */
function isRtlLayout(anchors: PdfColumnAnchor[]): boolean {
  let arabic = 0;
  let latin = 0;
  for (const anchor of anchors) {
    arabic += (anchor.header.match(/[\u0600-\u06FF]/g) ?? []).length;
    latin += (anchor.header.match(/[A-Za-z]/g) ?? []).length;
  }
  return arabic > 0 && arabic >= latin;
}

/**
 * ضبط الإسناد للنص العربي: الكلمات القصيرة تُحاذى ليمين عمودها، فيزيح «مركز»
 * الكلمة إلى عمود التاريخ المجاور. نستخرج حدّ اليمين الفعلي لكل عمود من بياناته،
 * ثم نعيد إسناد صفوف البيانات بمقارنة حدّ اليمين — مع إبقاء صفوف الترويسة كما هي.
 */
function alignToRightEdges(
  rows: Row[],
  anchors: PdfColumnAnchor[],
  assigned: Word[][][],
  headerRows: number,
): void {
  if (!isRtlLayout(anchors)) return;
  const edges = anchors.map((anchor, column) => {
    const rights: number[] = [];
    for (let rowIndex = headerRows; rowIndex < rows.length; rowIndex += 1) {
      for (const word of assigned[rowIndex][column]) {
        rights.push(word.x + word.width);
      }
    }
    if (!rights.length) return anchor.right;
    rights.sort((a, b) => a - b);
    // الوسيط لا الحد الأقصى: قيمة شاذة واحدة في صفحة تكميلية لا تزيح العمود كله
    return Math.max(rights[(rights.length - 1) >> 1], anchor.x);
  });
  for (let rowIndex = headerRows; rowIndex < rows.length; rowIndex += 1) {
    const next: Word[][] = anchors.map(() => []);
    const current = assigned[rowIndex];
    for (let column = 0; column < current.length; column += 1) {
      for (const word of current[column]) {
        const edge = word.x + word.width;
        let best = column;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let candidate = 0; candidate < edges.length; candidate += 1) {
          const distance = Math.abs(edges[candidate] - edge);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
          }
        }
        next[best].push(word);
      }
    }
    assigned[rowIndex] = next;
  }
}

function joinWords(words: Word[], order: 'asc' | 'desc', separator = ' '): string {
  return [...words]
    .sort((a, b) => (order === 'asc' ? a.x - b.x : b.x - a.x))
    .map((word) => word.text)
    .join(separator);
}

/** نوع العمود: من الترويسة أولاً، ثم من محتوى البيانات (تاريخ/رقم/نص) */
function columnTypes(rows: Row[], anchors: PdfColumnAnchor[], headerRows: number, assigned: Word[][][]): CellType[] {
  return anchors.map((anchor, column) => {
    if (anchor.field === 'date') return 'date';
    if (anchor.field === 'debit' || anchor.field === 'credit' || anchor.field === 'amount' || anchor.field === 'balance') return 'number';
    if (anchor.field === 'description' || anchor.field === 'docNo' || anchor.field === 'docType' || anchor.field === 'ref') return 'text';
    let dates = 0;
    let amounts = 0;
    let texts = 0;
    for (let rowIndex = headerRows; rowIndex < rows.length; rowIndex += 1) {
      for (const word of assigned[rowIndex][column]) {
        if (parseDateAny(word.text)) dates += 1;
        else if (parseAmountAny(word.text) !== null) amounts += 1;
        else texts += 1;
      }
    }
    if (dates > 0 && dates >= amounts && dates >= texts) return 'date';
    if (amounts > 0 && amounts >= texts) return 'number';
    return 'text';
  });
}

function buildCell(words: Word[], type: CellType, isHeader: boolean): string {
  if (!words.length) return '';
  if (isHeader) return joinWords(words, 'desc');
  if (type === 'number') {
    const numeric = words.filter((word) => parseAmountAny(word.text) !== null);
    return joinWords(numeric.length ? numeric : words, 'asc');
  }
  if (type === 'date') {
    const compact = joinWords(words, 'asc', '');
    if (parseDateAny(compact)) return compact;
    return joinWords(words, 'asc');
  }
  // النص العربي يُقرأ من اليمين لليسار: ترتيب تنازلي حسب x يعيد التسلسل المنطقي
  return joinWords(words, 'desc');
}

const TOTAL_ROW = /^(?:ال)?(?:رصيد|اجمالي|إجمالي|مجموع|نهائي|ختامي|total|balance|closing|opening)(?=$|[\s:\-–—])/i;
/** عبارات تذييل الكشف (توقيع/مجاميع/طباعة) — لا تُدمج في وصف آخر حركة */
const FOOTER_HINT = /(?:اسم المستلم|المستلم|الادارة|الإدارة|المحاسب|التوقيع|صافي الرصيد|الجماليات|رصيد حالي|رصيد ختامي|صافي المسحوبات|(?:اجمالي|إجمالي)\s+(?:العمليات|المسحوبات|المردودات|الرصيد|قيمة)|يعتبر .{0,12}الكشف|اعتراض|آخر طباعة|فاكس|العنوان|Web ?Site|انتاج من نظام|إنتاج من نظام)/i;
/** صف افتتاحي/ختامي لا يُدمج في وصف حركة */
const OPENING_CLOSING_ROW = /(?:افتتاحي|فتتاحي|رصيد\s*(?:سابق|مدور|ما قبله|ختامي|نهائي)|مدور|closing|opening)/i;

/** دمج أجزاء التاريخ المقسوم بين سطرين («2025-01-» + «01») داخل عمود التاريخ */
function mergeSplitDates(rows: unknown[][], dateColumns: number[], headerRows: number): void {
  for (const column of dateColumns) {
    for (let index = headerRows; index < rows.length; index += 1) {
      const first = String(rows[index]?.[column] ?? '').trim();
      if (!first || parseDateAny(first)) continue;
      for (let ahead = 1; ahead <= 2 && index + ahead < rows.length; ahead += 1) {
        const second = String(rows[index + ahead]?.[column] ?? '').trim();
        if (!second) continue;
        if (!/^[\d\s./-]+$/.test(first + second)) break;
        const merged = [first + second, `${first} ${second}`, `${first}-${second}`].find((candidate) => parseDateAny(candidate));
        if (merged) {
          rows[index][column] = merged;
          rows[index + ahead][column] = '';
          break;
        }
        if (second.length > 4) break;
      }
    }
  }
}

/**
 * دمج أسطر الوصف المكمّلة (سطر بلا تاريخ/مبلغ) في بند سابق، مع الحفاظ على
 * صفوف المجاميع والأرصدة وترويسات الصفحات. الأسطر التي تحمل نصاً في عمود
 * رقمي/تاريخي تُترك كما هي (تذييل/ترويسة) حتى لا تُلصق بوصف بند.
 */
function mergeContinuationRows(
  rows: unknown[][],
  types: CellType[],
  descriptionColumn: number,
  dateColumns: number[],
  numericColumns: number[],
  headerRows: number,
): void {
  for (let index = headerRows + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const cells = row.map((value, column) => ({ column, text: String(value ?? '').trim() })).filter((cell) => cell.text);
    if (!cells.length) {
      rows.splice(index, 1);
      index -= 1;
      continue;
    }
    const hasDate = dateColumns.some((column) => parseDateAny(String(row[column] ?? '')));
    const hasAmount = numericColumns.some((column) => parseAmountAny(String(row[column] ?? '')) !== null);
    if (hasDate) continue;
    // ترتيب الخلايا من اليمين لليسار ليعود النص بترتيب قراءته المنطقي
    const ordered = [...cells].sort((a, b) => b.column - a.column);
    const next = ordered.map((cell) => cell.text).join(' ');
    const summary = TOTAL_ROW.test(next);
    const looksHeader = cells.filter((cell) => isHeaderLike(cell.text)).length >= 2;
    const footer = FOOTER_HINT.test(next);
    if (summary || looksHeader || footer || OPENING_CLOSING_ROW.test(next)) continue;
    // صف أرقام فقط بلا وصف = تذييل/مجاميع، لا تكملة وصف
    if (hasAmount && next.replace(/[\d.,\s/:=\-–—]+/g, '').length < 4) continue;
    // نص في عمود رقمي/تاريخي = تذييل أو ترويسة مكررة، لا تكملة وصف
    const misplaced = cells.some((cell) => types[cell.column] !== 'text');
    if (misplaced && next.replace(/[\d.,\s/:=\-–—]+/g, '').length < 8) continue;

    let target = descriptionColumn;
    if (target < 0) {
      let longest = 0;
      for (const cell of cells) {
        if (types[cell.column] === 'text' && cell.text.length > longest) {
          longest = cell.text.length;
          target = cell.column;
        }
      }
    }
    if (target < 0) continue;
    const previous = String(rows[index - 1]?.[target] ?? '').trim();
    rows[index - 1][target] = [previous, next].filter(Boolean).join(' ');
    rows.splice(index, 1);
    index -= 1;
  }
}

/**
 * إعادة بناء جدول صفحة PDF. تُمرَّر `prior` لصفحات بلا ترويسة (تكملة كشف):
 * تُستخدم أعمدتها المعروفة نفسها، وتُحذف صفوف المقدمة حتى أول حركة مالية.
 */
export function reconstructPdfTable(items: PdfTextItem[], prior?: PdfLayout | null): PdfTable | null {
  const rows = groupPdfRows(extractPdfWords(items));
  if (!rows.length) return null;

  const detected = detectLayout(rows, prior);
  if (!detected) return null;

  let layout = detected.layout;
  let tableRows = rows;

  // تقليم المقدمة (اسم الشركة/التاريخ...) ليبقى صف الترويسة ضمن أول صفوف الشبكة
  if (detected.mainIndex > 2) {
    const trim = detected.mainIndex - 2;
    tableRows = rows.slice(trim);
    layout = { ...layout, headerRows: layout.headerRows - trim };
  }

  // تعيين كل مقطع لأقرب عمود
  const assign = (anchors: PdfColumnAnchor[]): Word[][][] => tableRows.map(() => anchors.map(() => [] as Word[]));
  let assigned = assign(layout.anchors);
  for (let rowIndex = 0; rowIndex < tableRows.length; rowIndex += 1) {
    for (const word of tableRows[rowIndex].words) {
      const center = word.x + word.width / 2;
      let bestColumn = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let column = 0; column < layout.anchors.length; column += 1) {
        const distance = Math.abs(layout.anchors[column].x - center);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestColumn = column;
        }
      }
      assigned[rowIndex][bestColumn].push(word);
    }
  }

  // أعمدة الترويسة بلا أي بيانات (مثل ترويسة مجموعة «المبلغ» فوق مدين/دائن) تُسقَط
  if (layout.headerRows > 0) {
    const keep = layout.anchors
      .map((_, column) => column)
      .filter((column) => assigned.some((row, rowIndex) => rowIndex >= layout.headerRows && row[column].length > 0));
    if (keep.length >= 2 && keep.length < layout.anchors.length) {
      layout = { ...layout, anchors: keep.map((column) => layout.anchors[column]) };
      assigned = assigned.map((row) => keep.map((column) => row[column]));
    }
  }

  // صفحة تكملة بلا ترويسة: احذف المقدمة حتى أول صف فيه مبلغ
  if (layout.headerRows === 0) {
    const typesForPrefilter = columnTypes(tableRows, layout.anchors, 0, assigned);
    const numericColumns = typesForPrefilter.map((type, column) => (type === 'number' ? column : -1)).filter((column) => column >= 0);
    const start = tableRows.findIndex((_, rowIndex) =>
      numericColumns.some((column) => assigned[rowIndex][column].some((word) => parseAmountAny(word.text) !== null)));
    if (start < 0) return null;
    if (start > 0) {
      tableRows = tableRows.slice(start);
      assigned = assigned.slice(start);
    }
  }

  const types = columnTypes(tableRows, layout.anchors, layout.headerRows, assigned);
  alignToRightEdges(tableRows, layout.anchors, assigned, layout.headerRows);
  const grid: unknown[][] = tableRows.map((_, rowIndex) => layout.anchors.map((_, column) => {
    const words = assigned[rowIndex][column];
    return buildCell(words, types[column], rowIndex < layout.headerRows);
  }));

  const dateColumns = types.map((type, column) => (type === 'date' ? column : -1)).filter((column) => column >= 0);
  const numericColumns = types.map((type, column) => (type === 'number' ? column : -1)).filter((column) => column >= 0);
  const descriptionColumn = layout.anchors.findIndex((anchor) => anchor.field === 'description');

  mergeSplitDates(grid, dateColumns, layout.headerRows);
  mergeContinuationRows(grid, types, descriptionColumn, dateColumns, numericColumns, layout.headerRows);

  // قطع كتلة التذييل: كل ما يلي آخر صف مؤرّخ هو مجاميع/توقيع/طباعة، لا حركات.
  // الاعتماد على آخر تاريخ (لا أول صف بلا تاريخ) ضروري لأن أسطر الوصف المكمّلة
  // داخل الجدول قد تخلو من التاريخ ولا يجوز قطعها.
  if (dateColumns.length) {
    let lastDated = -1;
    for (let index = layout.headerRows; index < grid.length; index += 1) {
      const hasDate = dateColumns.some((column) => parseDateAny(String(grid[index]?.[column] ?? '')) !== null);
      if (hasDate) lastDated = index;
    }
    if (lastDated >= 0) grid.length = lastDated + 1;
  }

  return { rows: grid, layout };
}
