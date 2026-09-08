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
}

export interface CommitResult {
  statementId: number;
  lineCount: number;
  totalDebit: number;
  totalCredit: number;
}

/** قوالب الاستيراد المتاحة لحساب (مع خيار تلقائي دائماً في المقدمة) */
export async function listAccountTemplates(accountId: number) {
  const { templates } = await api.get<{ templates: Array<{ id: number; name: string; templateKind: 'ours' | 'theirs'; isDefault: boolean }> }>(
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
  pages: number;
  mode: 'text' | 'ocr';
  opening: number | null;
  lines: OcrDraftLine[];
}

/** استخراج بنود كشف PDF محلياً (طبقة نصية أو OCR) — مسودة مراجعة فقط */export function ocrStatementPdf(accountId: number, side: StatementSide, file: File): Promise<OcrDraft> {
  // الخادم يغلّف المسودة: { draft: {...} } — نفك الغلاف هنا
  return uploadFile<{ draft: OcrDraft }>('/api/v1/statements/ocr', file, {
    accountId: String(accountId),
    side,
  }).then((r) => r.draft);
}

/** اعتماد بنود بعد المراجعة (مسار الإدخال اليدوي نفسه) */
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

/** رفع ملف كشف → معاينة قابلة للتصحيح (لا يُكتب شيء في القاعدة بعد) */
export function uploadStatementPreview(
  accountId: number,
  side: StatementSide,
  file: File,
  templateId: string | null,
): Promise<UploadPreview> {
  return uploadFile<UploadPreview>('/api/v1/statements/upload', file, {
    accountId: String(accountId),
    side,
    templateId: templateId ?? '',
  });
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
