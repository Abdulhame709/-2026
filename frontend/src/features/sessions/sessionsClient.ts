import { api } from '@/shared/api/client';
import type { CurrencyCode, SessionStatus } from '@/shared/types';

/**
 * عميل جلسات المطابقة (Module 4) — يطابق /api/v1/sessions الخلفية.
 * الجلسة = مورد + عملة + فترة، كشفان مرتبطان، ومجموعات ربط (اقتراحات + يدوي).
 */

export interface SideProgress {
  lineCount: number;
  total: number;
  matchedConfirmed: number;
  matchedSuggested: number;
  leftover: number;
  leftoverCount: number;
}

export interface SessionProgress {
  ours: SideProgress;
  theirs: SideProgress;
  matchRatePct: number;
}

export interface SessionListItem {
  id: number;
  accountId: number;
  currencyCode: CurrencyCode;
  periodLabel: string;
  ourStatementId: number | null;
  theirStatementId: number | null;
  status: SessionStatus;
  openingOurs: number | null;
  openingTheirs: number | null;
  carriedFromSessionId: number | null;
  createdAt: string;
  closedAt: string | null;
  partner: { id: number; code: string; nameAr: string };
  progress: SessionProgress;
}

export interface WsLine {
  id: number;
  lineNo: number;
  entryDate: string | null;
  docType: string;
  docNo: string;
  description: string;
  ref: string;
  debit: number | null;
  credit: number | null;
  signed: number;
  /** المتبقي غير المربوط من البند (|الموقّع| − المستهلك) */
  remaining: number;
}

export interface StatementBrief {
  id: number;
  periodStart: string | null;
  periodEnd: string | null;
  opening: number | null;
  closing: number | null;
  fileName: string | null;
  lines: WsLine[];
}

export type MatchRule = 'exact_ref' | 'ref_map' | 'description_ref' | 'amount_date' | 'manual';

export interface GroupItem {
  lineId: number;
  allocated: number | null;
}

export interface MatchGroup {
  id: number;
  rule: MatchRule;
  status: 'suggested' | 'confirmed';
  isActive: boolean;
  confidence: number | null;
  note: string | null;
  pairKey: string | null;
  createdAt: string;
  items: GroupItem[];
}

export interface CloseDiscrepancy {
  type: 'ours_only' | 'theirs_only';
  lineNo: number;
  date: string | null;
  description: string;
  amount: number;
}

export interface SessionDetail {
  session: {
    id: number;
    status: SessionStatus;
    periodLabel: string;
    currencyCode: CurrencyCode;
    openingOurs: number | null;
    openingTheirs: number | null;
    carriedFromSessionId: number | null;
    carriedFromPeriod: string | null;
    openingAdjustReason: string | null;
    createdAt: string;
    closedAt: string | null;
    closeSummary: {
      matchRatePct: number;
      totals: { ours: SideProgress; theirs: SideProgress };
      discrepancies: CloseDiscrepancy[];
    } | null;
  };
  partner: { id: number; code: string; nameAr: string };
  ourStatement: StatementBrief | null;
  theirStatement: StatementBrief | null;
  groups: MatchGroup[];
  progress: SessionProgress;
}

export interface OpeningSuggestion {
  fromSessionId: number;
  periodLabel: string | null;
  closedAt: string | null;
  closingOurs: number;
  closingTheirs: number;
}

/** اقتراح الافتتاحي (D9): ختامي آخر جلسة مغلقة لنفس الحساب — null إن لا يوجد */
export const fetchOpeningSuggestion = (accountId: number) =>
  api
    .get<{ suggestion: OpeningSuggestion | null }>(`/api/v1/sessions/opening-suggestion?accountId=${accountId}`)
    .then((r) => r.suggestion);

/** إنشاء جلسة — 409 SESSION_EXISTS إن وُجدت مفتوحة لنفس الحساب والفترة */
export function createSession(input: {
  accountId: number;
  periodLabel: string;
  openingBalance?: number | null;
  openingTheirs?: number | null;
  carriedFromSessionId?: number | null;
  openingAdjustReason?: string | null;
}) {
  return api.post<{ session: { id: number; status: SessionStatus; periodLabel: string } }>('/api/v1/sessions', input);
}

export const listSessions = (status?: SessionStatus) =>
  api.get<{ sessions: SessionListItem[] }>(`/api/v1/sessions${status ? `?status=${status}` : ''}`).then((r) => r.sessions);

export const getSessionDetail = (id: number) => api.get<SessionDetail>(`/api/v1/sessions/${id}`);

/** تعديل جلسة مفتوحة (الفترة والافتتاحيان) — المغلقة ترفض خادمياً */
export const updateSession = (
  id: number,
  patch: { periodLabel?: string; openingOurs?: number | null; openingTheirs?: number | null; openingAdjustReason?: string | null },
) => api.patch<{ session: { id: number } }>(`/api/v1/sessions/${id}`, patch);

/** حذف جلسة فارغة (أدمن) — الخادم يرفض ذي الكشوف أو الفروق برسالة واضحة */
export const deleteSession = (id: number) => api.delete<{ ok: boolean }>(`/api/v1/sessions/${id}`);

export const suggestMatches = (id: number) =>
  api.post<{ suggested: number; autoConfirmed: number }>(`/api/v1/sessions/${id}/suggest`);

export const confirmGroup = (groupId: number) =>
  api.post<{ groupId: number; status: string }>(`/api/v1/sessions/groups/${groupId}/confirm`);

export const rejectGroup = (groupId: number) =>
  api.post<{ groupId: number; status: string }>(`/api/v1/sessions/groups/${groupId}/reject`);

export const unlinkGroup = (groupId: number) =>
  api.post<{ groupId: number; status: string }>(`/api/v1/sessions/groups/${groupId}/unlink`);

export const adjustAllocations = (groupId: number, items: GroupItem[]) =>
  api.patch<{ groupId: number; items: number }>(`/api/v1/sessions/groups/${groupId}/allocations`, { items });

export const manualGroup = (sessionId: number, items: GroupItem[], note?: string) =>
  api.post<{ groupId: number }>(`/api/v1/sessions/${sessionId}/groups`, { items, note });

export const closeSession = (id: number) =>
  api.post<{ summary: { matchRatePct: number; discrepancies: CloseDiscrepancy[] } }>(`/api/v1/sessions/${id}/close`);

export const reopenSession = (id: number) =>
  api.post<{ session: { id: number; status: SessionStatus } }>(`/api/v1/sessions/${id}/reopen`);

/** تسميات القواعد بالعربية — شفافية «لماذا رُبط هذا البند؟» */
export const RULE_LABELS: Record<MatchRule, string> = {
  exact_ref: 'مرجع مطابق',
  ref_map: 'خريطة المراجع',
  description_ref: 'مرجع من البيان',
  amount_date: 'مبلغ وتاريخ',
  manual: 'ربط يدوي',
};
