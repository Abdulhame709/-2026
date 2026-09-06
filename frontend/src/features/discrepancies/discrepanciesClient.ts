import { api } from '@/shared/api/client';
import type { CurrencyCode } from '@/shared/types';

/**
 * عميل الفروق (Module 5) — يطابق /api/v1/discrepancies الخلفية.
 * الفروق تُولَّد آلياً عند إغلاق الجلسة من البنود المتبقية، وهنا إدارتها:
 * سبب جاهز + مسؤول + حالة + ملاحظة حل + ترحيل للجلسة التالية.
 */

export type DiscrepancyType = 'amount_diff' | 'date_diff' | 'ref_diff' | 'ours_only' | 'theirs_only';
export type DiscrepancyStatus = 'new' | 'in_progress' | 'resolved' | 'accepted';

export interface DiscrepancyFull {
  id: number;
  sessionId: number;
  type: DiscrepancyType;
  ourLineId: number | null;
  theirLineId: number | null;
  ourAmount: number | null;
  theirAmount: number | null;
  diffAmount: number | null;
  reasonCodeId: number | null;
  reasonCodeName: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  status: DiscrepancyStatus;
  resolutionNote: string | null;
  carriedToSessionId: number | null;
  lineDescription: string | null;
  lineDate: string | null;
  partnerName: string;
  periodLabel: string;
  currencyCode: CurrencyCode;
  accountId: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReasonCode {
  id: number;
  code: string;
  nameAr: string;
}

export interface AssigneeUser {
  id: number;
  fullName: string;
  role: 'admin' | 'reconciler' | 'viewer';
}

export const listDiscrepancies = (filters: { sessionId?: number; status?: string; accountId?: number } = {}) => {
  const qs = new URLSearchParams();
  if (filters.sessionId) qs.set('sessionId', String(filters.sessionId));
  if (filters.status) qs.set('status', filters.status);
  if (filters.accountId) qs.set('accountId', String(filters.accountId));
  const q = qs.toString();
  return api
    .get<{ discrepancies: DiscrepancyFull[] }>(`/api/v1/discrepancies${q ? `?${q}` : ''}`)
    .then((r) => r.discrepancies);
};

export const updateDiscrepancy = (
  id: number,
  patch: { status?: DiscrepancyStatus; assigneeId?: number | null; reasonCodeId?: number | null; resolutionNote?: string | null },
) => api.patch<{ discrepancy: DiscrepancyFull }>(`/api/v1/discrepancies/${id}`, patch).then((r) => r.discrepancy);

export const carryDiscrepancy = (id: number, targetSessionId: number) =>
  api.post<{ id: number; carriedToSessionId: number }>(`/api/v1/discrepancies/${id}/carry`, { targetSessionId });

export const listReasonCodes = () =>
  api.get<{ reasonCodes: ReasonCode[] }>('/api/v1/reason-codes').then((r) => r.reasonCodes);

/** المسؤولون = من يملك صلاحية المعالجة (أدمن/مطابِق) */
export const listAssignees = () =>
  api.get<{ users: AssigneeUser[] }>('/api/v1/users').then((r) =>
    r.users.filter((u) => u.role === 'admin' || u.role === 'reconciler'),
  );

// ===== تعليقات الفروق (Module 7) — الجميع يعلّق، والتقرير يطبعها تحت كل فرق =====

export interface DiscrepancyComment {
  id: number;
  discrepancyId: number;
  authorId: number;
  authorName: string;
  authorRole: 'admin' | 'reconciler' | 'viewer';
  body: string;
  createdAt: string;
}

export const listComments = (discrepancyId: number) =>
  api
    .get<{ comments: DiscrepancyComment[] }>(`/api/v1/discrepancies/${discrepancyId}/comments`)
    .then((r) => r.comments);

export const addComment = (discrepancyId: number, body: string) =>
  api
    .post<{ comment: DiscrepancyComment }>(`/api/v1/discrepancies/${discrepancyId}/comments`, { body })
    .then((r) => r.comment);

export const deleteComment = (commentId: number) =>
  api.delete<{ ok: boolean }>(`/api/v1/discrepancies/comments/${commentId}`);

/** ملاحظات كل فروق الجلسة — لتقرير الجلسة المطبوع (نداء واحد) */
export const listSessionComments = (sessionId: number) =>
  api
    .get<{ comments: DiscrepancyComment[] }>(`/api/v1/discrepancies/session/${sessionId}/comments`)
    .then((r) => r.comments);

/** عمر الفرق بالأيام — للتلوين والفرز */
export const ageInDays = (createdAt: string): number =>
  Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
