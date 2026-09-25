import path from 'node:path';
import { mkdir, copyFile } from 'node:fs/promises';
import { ERR } from '../domain/errors.js';

/**
 * استخراج بنود كشوف PDF محلياً بالكامل (Module 11 — Q16: لا أي خدمة سحابية):
 * 1) إن كان للملف طبقة نصية رقمية → استخراج مباشر (بلا OCR).
 * 2) إن كان ممسوحاً (صور) → تصيير الصفحات محلياً (pdfjs + canvas) وقراءتها
 *    بمحرك Tesseract المضمّن بنموذجي العربية والإنجليزية المحليين.
 * الناتج «مسودة للمراجعة إلزامياً» — الاعتماد يتم عبر مسار الإدخال اليدوي
 * بعد أن يراجع المستخدم كل بند (القراءة الآلية قد تخطئ).
 */

// ===== تفييء خامل لمحرك OCR (يعمل عند أول ملف PDF ممسوح فقط) =====
type OcrWorker = { recognize: (img: Buffer) => Promise<{ data: { text: string; confidence?: number } }>; terminate: () => Promise<unknown> };
let workerPromise: Promise<OcrWorker> | null = null;

async function tessDataDir(): Promise<string> {
  // النماذج تأتي من حزم npm محلية — تُنسخ لمجلد واحد يقرأه المحرك (أول مرة فقط)
  const dir = path.resolve('storage/tessdata');
  await mkdir(dir, { recursive: true });
  const araGz = path.resolve('node_modules/@tesseract.js-data/ara/4.0.0/ara.traineddata.gz');
  const engGz = path.resolve('node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz');
  await copyFile(araGz, path.join(dir, 'ara.traineddata.gz')).catch(() => undefined);
  await copyFile(engGz, path.join(dir, 'eng.traineddata.gz')).catch(() => undefined);
  return dir;
}

async function getWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const langPath = await tessDataDir();
      const worker = await createWorker('ara+eng', 1, { langPath, gzip: true, cacheMethod: 'none' });
      return worker as unknown as OcrWorker;
    })();
  }
  return workerPromise;
}

// ===== أدوات تحليل النص =====

const DATE_RE = /\b(\d{1,4}[/\-.]\d{1,2}[/\-.]\d{2,4})\b/;
const NUM_RE = /-?\d{1,3}(?:,\d{3})+(?:\.\d{1,4})?|-?\d+(?:\.\d{1,4})?/g;
const OPENING_HINT = /(منقول|فتتاحي|رصيد|opening\s*balance|b\/f)/i; // «فتتاحي» تلتقط افتتاحي والإفتتاحي
const CLOSING_HINT = /(ختامي|ختامية|نهائي|إجمالي|اجمالي|المجموع|closing\s*balance|c\/f)/i;

const toNum = (raw: string): number | null => {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

export interface OcrLine {
  lineNo: number;
  dateRaw: string;
  description: string;
  ref: string;
  debitRaw: string;
  creditRaw: string;
  ocrConfidence: number | null;
}

/** صف من سطر نصي: تاريخ + مبالغ + وصف — إرشادي يخضع لمراجعة المستخدم */
/** عزل المراجع الملتصقة بالحروف (INV-1، PO-2024، ق-123) — أرقامها ليست مبالغ */
const REF_TOKEN_RE = /[A-Za-z\u0600-\u06FF][A-Za-z0-9\u0600-\u06FF_-]*\d[\d.,]*/g;
const stripRefs = (s: string): string => s.replace(REF_TOKEN_RE, ' ');

/** ترويسات وتذييلات الكشوف — كلمات مفردة (مستقلة عن ترتيب الكلمات لأن استخراج RTL قد يعكسها) */
const HEADER_WORD = /(تلفون|هاتف|فاكس|الطباعة|طباعة|صفحة|page\s*\d|العنوان|الفترة)/i;
const isHeaderLine = (raw: string): boolean => {
  if (HEADER_WORD.test(raw)) return true;
  const has = (w: string) => raw.includes(w);
  if (has('كشف') && has('حساب')) return true;
  if (has('اسم') && (has('العميل') || has('المورد'))) return true;
  return false;
};

function lineToRow(line: string, lineNo: number, confidence: number | null): OcrLine | null {
  const cleaned = line.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').replace(/[|¦]/g, ' | ').replace(/ {2,}/g, ' ').trim();
  if (cleaned.length < 3) return null;

  // تخطيط أعمدة صريح — تحليل عام مستقل عن اتجاه المقاطع (منطقي أو بصري):
  // خلية الوصف = الأكثر حروفاً عربية، والتاريخ من أي خلية، والمال من بقية الخلايا بترتيبها.
  if (cleaned.includes('|')) {
    const cells = cleaned.split('|').map((c) => c.trim()).filter(Boolean);
    const dateCell = cells.find((c) => DATE_RE.test(c));
    const dateMatch = dateCell ? DATE_RE.exec(dateCell) : null;
    const dateRaw = dateMatch ? dateMatch[1] : '';
    const arabicCount = (c: string): number => (c.match(/[\u0600-\u06FF]/g) ?? []).length;
    const descCell = cells
      .filter((c) => c !== dateCell)
      .slice()
      .sort((a, b) => arabicCount(b) - arabicCount(a))[0];
    const description = (descCell ?? '').replace(new RegExp(NUM_RE.source, 'g'), ' ').replace(/\s+/g, ' ').trim();
    const moneyCells = cells
      .filter((c) => c !== dateCell && c !== descCell)
      .flatMap((c) => stripRefs(c).match(NUM_RE) ?? []);
    const amounts = moneyCells.map(toNum).filter((n): n is number => n != null);
    if (!dateRaw && amounts.length === 0) return null;
    return {
      lineNo,
      dateRaw,
      description: (description || '—').slice(0, 280),
      ref: '',
      debitRaw: amounts.length >= 1 ? String(Math.abs(amounts[0])) : '',
      creditRaw: amounts.length >= 2 ? String(Math.abs(amounts[1])) : '',
      ocrConfidence: confidence,
    };
  }

  // بلا أعمدة: تاريخ + آخر رقمين مدين/دائن
  const dateMatch = DATE_RE.exec(cleaned);
  const dateRaw = dateMatch ? dateMatch[1] : '';
  const withoutDate = dateMatch ? (cleaned.slice(0, dateMatch.index) + ' ' + cleaned.slice(dateMatch.index + dateMatch[0].length)).trim() : cleaned;
  const nums = (stripRefs(withoutDate).match(NUM_RE) ?? []).map(toNum).filter((n): n is number => n != null);
  // كشوف التفصيل بعمود رصيد مجمع: آخر رقم رصيد وليس حركة — نستبعده عند ازدحام الأرقام ثم نأخذ الآخرين
  const amounts = (nums.length >= 3 ? nums.slice(0, -1) : nums).slice(-2);
  let description = withoutDate;
  for (const raw of withoutDate.match(NUM_RE) ?? []) description = description.replace(raw, ' ');
  description = description.replace(/\s+/g, ' ').replace(/^[-–—:]+|[-–—:]+$/g, '').trim();
  if (!dateRaw && amounts.length === 0) return null; // سطر ترويسة/ملاحظة
  return {
    lineNo,
    dateRaw,
    description: description.slice(0, 280) || '—',
    ref: '',
    debitRaw: amounts.length >= 1 ? String(Math.abs(amounts[0])) : '',
    creditRaw: amounts.length >= 2 ? String(Math.abs(amounts[1])) : '',
    ocrConfidence: confidence,
  };
}

export interface OcrResult {
  pages: number;
  mode: 'text' | 'ocr';
  opening: number | null;
  lines: OcrLine[];
}

/** تجميع أسطر الطبقة النصية (من الأعلى للأسفل، وترتيب الإصدار داخل السطر) */
function textLayerLines(items: Array<{ str?: string; transform: number[] }>): string[] {
  const byLine = new Map<number, Array<{ x: number; str: string }>>();
  for (const it of items) {
    const str = (it.str ?? '').trim();
    if (!str) continue;
    const y = Math.round(it.transform[5] / 4) * 4;
    const list = byLine.get(y) ?? [];
    list.push({ x: it.transform[4], str });
    byLine.set(y, list);
  }
  return [...byLine.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, list]) => list.map((i) => i.str).join(' '))
    .filter(Boolean);
}

/** تحليل أسطر نصية إلى بنود إرشادية للمراجعة — يفصل الترويسات/الافتتاحي/الختامي عن البنود.
 *  مشتركة بين استخراج PDF واستخراج الصور (نفس منطق التحليل لضمان اتساق النتائج). */
function parseAll(raws: string[], conf: number | null, opts?: { requireDate?: boolean }) {
  const requireDate = opts?.requireDate ?? true;
  const out: OcrLine[] = [];
  let op: number | null = null;
  let prev: number | null = null; // سلسلة الرصيد المجمع لكشوف التفصيل
  for (const raw of raws) {
    // ترويسات وتذييلات الكشف (تلفون/فاكس/طباعة/صفحة/عناوين/إجماليات) — ليست بنوداً أبداً
    if (isHeaderLine(raw)) continue;
    if (CLOSING_HINT.test(raw)) continue;
    if (OPENING_HINT.test(raw)) {
      const nums = (raw.match(NUM_RE) ?? []).map(toNum).filter((n): n is number => n != null);
      const nz = nums.filter((n) => n !== 0);
      // الافتتاحي: رقم واحد، أو رقمين أحدهما صفر (عمودا مدين/دائن) — نأخذ غير الصفر
      if (op == null && (nz.length === 1 || nums.length === 1)) op = Math.abs(nz[0] ?? nums[0]);
      continue; // سطر الافتتاحي نفسه ليس بنداً مهما كان شكله
    }
    const row = lineToRow(raw, out.length + 1, conf);
    if (!row) continue;
    if (requireDate) {
      // البند الحقيقي له تاريخ ومبلغ — ما عدا ذلك بقايا ترويسة/فواصل
      if (!row.dateRaw || (!row.debitRaw && !row.creditRaw)) continue;
      // سلسلة الرصيد الذاتية التصحيح: ثلاثية متتالية (مدين، دائن، رصيد) تحقق
      // الرصيد = السابق − مدين + دائن — إثبات رياضي لا تخمين مهما اختلف ترتيب الأعمدة
      if (prev == null && op != null) prev = op;
      const dm = DATE_RE.exec(raw);
      const withoutDate = dm ? raw.slice(0, dm.index) + ' ' + raw.slice(dm.index + dm[0].length) : raw;
      const nums = (stripRefs(withoutDate).match(NUM_RE) ?? []).map(toNum).filter((n): n is number => n != null);
      if (prev != null) {
        let matched = false;
        for (let i = 0; i + 2 < nums.length; i++) {
          const d = nums[i];
          const c = nums[i + 1];
          const b = nums[i + 2];
          if (d == null || c == null || b == null) break;
          if (Math.abs(b - (prev - d + c)) < 0.005 || Math.abs(b - (prev + d - c)) < 0.005) {
            row.debitRaw = d !== 0 ? String(Math.abs(d)) : '';
            row.creditRaw = c !== 0 ? String(Math.abs(c)) : '';
            prev = b;
            matched = true;
            break;
          }
        }
        // بلا تطابق: نُقدّر السير من نتيجة lineToRow الاسترشادية لنكمل السلسلة
        if (!matched) {
          const d = Number(row.debitRaw || 0);
          const c = Number(row.creditRaw || 0);
          prev = prev - d + c;
        }
      }
    }
    out.push(row);
  }
  return { lines: out, opening: op };
}

export class OcrService {
  /** استخراج بنود كشف PDF — نص رقمي مباشر إن وُجد، وإلا OCR محلي للصور الممسوحة */
  async extractPdf(buffer: Buffer): Promise<OcrResult> {
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw ERR.VALIDATION([
        { field: 'file', messageAr: 'الملف ليس PDF سليماً (ترويسته مفقودة) — أعد تصديره من نظامك كـ PDF حقيقي' },
      ]);
    }
    let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs');
    try {
      pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as typeof import('pdfjs-dist/legacy/build/pdf.mjs');
    } catch {
      throw ERR.VALIDATION([{ field: 'file', messageAr: 'محرك قراءة PDF غير متوفر على الخادم' }]);
    }
    // قراءة الوثيقة — التشفير/التلف يُلتقط هنا برسالة واضحة لا انهيار 500
    let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
    try {
      const loaded = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
      loaded.onPassword = (_cb: (p: string | null) => void, reason: number) => {
        _cb(null); // لا نحاول تخمين كلمة مرور — نرفض برسالة واضحة
        void reason;
      };
      doc = await loaded.promise;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isPassword = /password|encrypt/i.test(msg);
      throw ERR.VALIDATION([
        {
          field: 'file',
          messageAr: isPassword
            ? 'ملف PDF محمي بكلمة مرور — أزِل الحماية من نظامك (Print → Save as PDF بديل عملي) ثم ارفعه'
            : 'تعذر فتح الملف — يبدو تالفاً أو غير مكتمل التحميل، أعد تصديره ثم ارفعه',
        },
      ]);
    }

    const MAX_PAGES = 60;
    if (doc.numPages > MAX_PAGES) {
      throw ERR.VALIDATION([
        { field: 'file', messageAr: `الملف كبير جداً (${doc.numPages} صفحة) — الحد ${MAX_PAGES}. قسّم الكشف أو صدّره Excel/CSV` },
      ]);
    }

    type PdfPage = Awaited<ReturnType<typeof doc.getPage>>;

    // جودة الصفحة: عدد البنود القابلة للاستخدام (مدين+دائن معاً عرف محاسبي مشروع وليس عيباً)
    const score = (ls: OcrLine[]) => ls.length;

    let confidence: number | null = null;
    const ocrPageLines = async (page: PdfPage): Promise<string[]> => {
      const { createCanvas } = await import('@napi-rs/canvas');
      const worker = await getWorker();
      const viewport = page.getViewport({ scale: 2.2 }); // ≈200dpi — توازن دقة/سرعة
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const { data } = await worker.recognize(canvas.toBuffer('image/png'));
      confidence = confidence == null ? (data.confidence ?? null) : (confidence + (data.confidence ?? 0)) / 2;
      return data.text.split(/\r?\n/);
    };

    // الحل الجذري لكل أنواع الـPDF: قرار لكل صفحة على حدة — نص إن كانت صالحة، وإلا تصوير + OCR
    const diag: string[] = [];
    const lines: OcrLine[] = [];
    let opening: number | null = null;
    let usedOcr = false;

    for (let p = 1; p <= doc.numPages; p++) {
      let page: PdfPage;
      try {
        page = await doc.getPage(p);
      } catch {
        diag.push(`ص${p}:تالفة-تجاوز`);
        continue;
      }
      let textRaw: string[] = [];
      try {
        const tc = await page.getTextContent();
        textRaw = textLayerLines(tc.items as Array<{ str?: string; transform: number[] }>);
      } catch {
        textRaw = [];
      }
      const chars = textRaw.join(' ').replace(/[^\p{L}\p{N}]/gu, '').length;
      const textParsed = parseAll(textRaw, null);
      let chosen = textParsed;
      let pageMode = 'نص';

      const needOcr =
        chars < 25 || textParsed.lines.length === 0 || score(textParsed.lines) < textParsed.lines.length * 0.6;
      if (needOcr) {
        try {
          const ocrParsed = parseAll(await ocrPageLines(page), confidence, { requireDate: true });
          usedOcr = true;
          if (score(ocrParsed.lines) >= score(chosen.lines)) {
            chosen = ocrParsed;
            pageMode = 'OCR';
          } else {
            pageMode = 'نص-أفضل';
          }
        } catch (e) {
          pageMode = `فشل-OCR:${e instanceof Error ? e.message.slice(0, 30) : '?'}`;
        }
      }
      diag.push(`ص${p}:[${pageMode} نص=${chars}ح بنود=${chosen.lines.length}]`);
      if (opening == null && chosen.opening != null) opening = chosen.opening;
      lines.push(...chosen.lines);
    }

    if (lines.length === 0) {
      throw ERR.VALIDATION([
        {
          field: 'file',
          messageAr: `لم يُستخرج أي بند من الملف (${diag.join(' ')}). إن كان الكشف ممسوحاً ضوئياً فجودته منخفضة، وإن كان نصياً فترميزه غير مقروء — أعد تصديره كـ PDF نصي أو Excel/CSV ثم ارفعه`,
        },
      ]);
    }
    // eslint-disable-next-line no-console
    console.log('[OCR-DIAG]', usedOcr ? 'OCR' : 'TEXT', diag.join(' '), '· بنود:', lines.length);
    return { pages: doc.numPages, mode: usedOcr ? 'ocr' : 'text', opening, lines };
  }

  /** استخراج بنود كشف من صورة (PNG/JPG) — OCR محلي مباشر بنفس محرك PDF الممسوح.
   *  لا توجد «صفحات» هنا — صورة واحدة تُمرَّر للعين الإلكترونية (Tesseract المضمّن)
   *  ثم تُحلَّل بنفس منطق parseAll لضمان اتساق النتائج مع استخراج PDF. */
  async extractImage(buffer: Buffer): Promise<OcrResult> {
    const worker = await getWorker();
    let recognized: { data: { text: string; confidence?: number } };
    try {
      recognized = await worker.recognize(buffer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw ERR.VALIDATION([
        { field: 'file', messageAr: `تعذرت قراءة الصورة — تأكد أنها صورة سليمة (PNG/JPG) غير تالفة. التفصيل: ${msg.slice(0, 80)}` },
      ]);
    }
    const textRaw = recognized.data.text.split(/\r?\n/);
    const conf = recognized.data.confidence ?? null;
    const parsed = parseAll(textRaw, conf, { requireDate: true });
    if (parsed.lines.length === 0) {
      throw ERR.VALIDATION([
        {
          field: 'file',
          messageAr: 'لم يُستخرج أي بند من الصورة — جودة الصورة منخفضة أو الإضاءة ضعيفة. أعد تصوير الكشف بوضوح وثبات أفضل (مستوٍ أفقياً، إضاءة جيدة، تركيز واضح) ثم ارفعه',
        },
      ]);
    }
    // eslint-disable-next-line no-console
    console.log('[OCR-DIAG] IMAGE بنود:', parsed.lines.length, '· ثقة:', conf);
    return { pages: 1, mode: 'ocr', opening: parsed.opening, lines: parsed.lines };
  }
}