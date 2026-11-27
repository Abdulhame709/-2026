import { api, uploadFile } from '@/shared/api/client';
import type { PreviewLine, StatementSide } from '@/shared/types';

/**
 * عميل استيراد الكشوفات (Module 3) — يطابق /api/v1/statements الخلفية.
 * upload=معاينة بالذاكرة (توكن 30 دقيقة) → تصحيح بنود → commit=كتابة نهائية.
 */

/** بند معاينة كما يعيده الخادم (نص خام قابل للتصحيح — FR-3.3) */
export interface ServerPreviewLine {
  lineNo: number;
  dateRaw: string;
  docType: string;
  docNo: string;
  description: string;
  ref: string;
  debitRaw: string;
  creditRaw: string;
}

export interface UploadPreview {
  token: string;
  lines: ServerPreviewLine[];
  opening: number | null;
  closingHint: number | null;
  templateId: number | null;
  lineCount: number;
  sheetName: string;
  decimalSep: string;
  thousandSep: string;
  mapping?: Record<string, string>;
}

/** حقول تعيين الأعمدة — مطابقة لمفاتيح الخادم */
export type MappingField =
  | 'date'
  | 'docType'
  | 'docNo'
  | 'description'
  | 'ref'
  | 'debit'
  | 'credit'
  | 'amount'
  | 'balance'
  | 'currency';

export interface InspectColumn {
  index: number;
  letter: string;
  header: string;
  sample: string[];
  field: MappingField | null;
}

/** نتيجة فحص الملف: ترويسة مكتشفة + تعيين مقترح — لا كتابة في القاعدة */
export interface InspectResult {
  sheetName: string;
  sheetNames: string[];
  headerRowIndex: number;
  headerRows: number;
  columns: InspectColumn[];
  mapping: Partial<Record<MappingField, string>>;
  decimalSep: string;
  thousandSep: string;
  warnings: string[];
}

export interface UploadOptions {
  mapping?: Partial<Record<MappingField, string>> | null;
  headerRows?: number | null;
  decimalSep?: string;
  thousandSep?: string;
  saveTemplate?: { name: string; isDefault: boolean } | null;
}

export interface CommitResult {
  statementId: number;
  lineCount: number;
  totalDebit: number;
  totalCredit: number;
}

/** قوالب الاستيراد المتاحة لحساب (مع خيار تلقائي دائماً في المقدمة) */
export async function listAccountTemplates(accountId: number) {
  const { templates } = await api.get<{ templates: Array<{ id: number; name: string; templateKind: 'ours' | 'theirs'; isDefault: boolean; decimalSep: string; thousandSep: string }> }>(
    `/api/v1/accounts/${accountId}/import-templates`,
  );
  return templates;
}

/** بند ناتج من استخراج PDF محلياً — مسودة إلزامية للمراجعة قبل الاعتماد (M11) */
export interface OcrDraftLine {
  lineNo: number;
  dateRaw: string;
  description: string;
  ref: string;
  debitRaw: string;
  creditRaw: string;
  ocrConfidence: number | null;
}

export interface OcrDraft {
  token: string;
  pages: number;
  mode: 'text' | 'ocr';
  opening: number | null;
  lines: OcrDraftLine[];
}

/** استخراج بنود كشف PDF محلياً (طبقة نصية أو OCR) — مسودة مراجعة فقط */export function ocrStatementPdf(accountId: number, side: StatementSide, file: File): Promise<OcrDraft> {
  return uploadFile<{ draft: Omit<OcrDraft, 'token'>; token: string }>('/api/v1/statements/ocr', file, {
    accountId: String(accountId),
    side,
  }).then((result) => ({ ...result.draft, token: result.token }));
}

/** إدخال يدوي بلا ملف أصلي */
export function commitManualStatement(
  accountId: number,
  side: StatementSide,
  body: { openingBalance?: number | null; sessionId?: number | null; lines: Array<{ entryDate: string; description: string; ref?: string; debit?: number | null; credit?: number | null }> },
): Promise<CommitResult> {
  return api.post<{ statementId: number; lineCount: number; totalDebit: number; totalCredit: number }>(
    '/api/v1/statements/manual',
    { accountId, side, ...body },
  );
}

/** فحص الملف: التعرّف على الأعمدة واقتراح التعيين قبل الرفع — لا كتابة في القاعدة */
export function inspectStatementFile(accountId: number, side: StatementSide, file: File): Promise<InspectResult> {
  return uploadFile<{ inspection: InspectResult }>('/api/v1/statements/inspect', file, {
    accountId: String(accountId),
    side,
  }).then((result) => result.inspection);
}

/** رفع ملف كشف → معاينة قابلة للتصحيح (لا يُكتب شيء في القاعدة بعد) */
export function uploadStatementPreview(
  accountId: number,
  side: StatementSide,
  file: File,
  templateId: string | null,
  options: UploadOptions = {},
): Promise<UploadPreview> {
  const fields: Record<string, string> = {
    accountId: String(accountId),
    side,
    templateId: templateId ?? '',
  };
  if (options.mapping) fields.mapping = JSON.stringify(options.mapping);
  if (options.headerRows != null) fields.headerRows = String(options.headerRows);
  if (options.decimalSep) fields.decimalSep = options.decimalSep;
  if (options.thousandSep) fields.thousandSep = options.thousandSep;
  if (options.saveTemplate) fields.saveTemplate = JSON.stringify(options.saveTemplate);
  return uploadFile<UploadPreview>('/api/v1/statements/upload', file, fields);
}

/** حفظ تصحيح بند في المعاينة (النسخة الخادمية هي المرجع عند الاعتماد) */
export function patchPreviewLine(token: string, lineNo: number, patch: Partial<PreviewLine>): Promise<{ line: ServerPreviewLine }> {
  return api.put(`/api/v1/statements/preview/${token}/lines/${lineNo}`, patch);
}

/** اعتماد الكشف — محقق التوثيق الثلاثي على الخادم (Q11) ثم كتابة معاملة واحدة */
export function commitStatementPreview(
  token: string,
  body: { openingBalance?: number | null; announcedClosing?: number | null; announcedCount?: number | null; sessionId?: number | null },
): Promise<CommitResult> {
  return api.post(`/api/v1/statements/preview/${token}/commit`, body);
}

/** خريطة بند المعاينة ← بند الواجهة (نفس الحقول نصياً) */
export function toPreviewLine(l: ServerPreviewLine): PreviewLine {
  return {
    lineNo: l.lineNo,
    dateRaw: l.dateRaw,
    docType: l.docType,
    docNo: l.docNo,
    description: l.description,
    ref: l.ref,
    debitRaw: l.debitRaw,
    creditRaw: l.creditRaw,
  };
}
