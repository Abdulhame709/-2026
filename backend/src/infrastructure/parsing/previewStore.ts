import { randomUUID } from 'node:crypto';
import { ERR } from '../../domain/errors.js';
import type { RawLine } from './statementParser.js';

/**
 * متجر المعاينة (FR-3.3): الكشف المُحلَّل يعيش بالذاكرة 30 دقيقة حتى الاعتماد —
 * لم يُكتب في القاعدة بعد (مواصفة §statements: upload = معاينة لم تُحفظ).
 * إعادة تشغيل الخادم تلغي المعاينات غير المعتمدة — مقبول: عمرها دقائق.
 */

interface PreviewSession {
  token: string;
  accountId: number;
  currencyCode: string;
  side: 'ours' | 'theirs';
  templateId: number | null;
  fileName: string;
  originalName: string;
  storedPath: string; // يُحفظ الملف فور الرفع — الاعتماد يسجل source_file
  sha256: string;
  mimeType: string | null;
  sizeBytes: number;
  lines: RawLine[];
  openingHint: number | null;
  createdBy: number;
  expiresAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const store = new Map<string, PreviewSession>();

export function putPreview(session: Omit<PreviewSession, 'token' | 'expiresAt'>): string {
  // تنظيف دوري رخيص: كل إنشاء يمسح المنتهي
  const now = Date.now();
  for (const [k, v] of store) if (v.expiresAt < now) store.delete(k);
  const token = randomUUID().replace(/-/g, '').slice(0, 24);
  store.set(token, { ...session, token, expiresAt: now + TTL_MS });
  return token;
}

export function getPreview(token: string): PreviewSession {
  const s = store.get(token);
  if (!s || s.expiresAt < Date.now()) {
    store.delete(token);
    throw ERR.PREVIEW_EXPIRED();
  }
  return s;
}

export function updatePreviewLine(
  token: string,
  lineNo: number,
  patch: Partial<Pick<RawLine, 'dateRaw' | 'description' | 'debitRaw' | 'creditRaw' | 'ref' | 'docType' | 'docNo'>>,
): RawLine {
  const s = getPreview(token);
  const line = s.lines.find((l) => l.lineNo === lineNo);
  if (!line) throw ERR.NOT_FOUND();
  Object.assign(line, patch);
  return line;
}

export function dropPreview(token: string): void {
  store.delete(token);
}
