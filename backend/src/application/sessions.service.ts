import type { Pool } from 'pg';
import { ERR } from '../domain/errors.js';
import type { AccountsRepository } from '../infrastructure/repositories/partners.repository.js';
import type { SessionsRepository, ReconciliationSession, SessionWithPartner } from '../infrastructure/repositories/reconciliation-sessions.repository.js';
import type { MatchesRepository, MatchGroup, StatementLineFull } from '../infrastructure/repositories/matches.repository.js';
import type { AuditRepository } from '../infrastructure/repositories/audit.repository.js';
import type { DiscrepanciesRepository } from '../infrastructure/repositories/discrepancies.repository.js';

/**
 * خدمة جلسات المطابقة (Module 4): إنشاء الجلسة أولاً (المعالج خطوة 1) —
 * الكشوفات ترتبط بها عند اعتمادها — ثم إغلاق بلقطة ملخص وإعادة فتح (أدمن).
 * صيغة الرصيد الكنسية: كشفهم = افتتاحي + مدين − دائن، كشفنا = افتتاحي + دائن − مدين.
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

const EPS = 0.005;

/** ملخص فروق الإغلاق: كل بند متبقٍ = عندهم فقط / عندنا فقط (M5 يفصّل الأسباب) */
export interface CloseDiscrepancy {
  type: 'ours_only' | 'theirs_only';
  lineId: number;
  lineNo: number;
  date: string | null;
  description: string;
  amount: number;
}

/** حساب التقدم من البنود + المجموعات النشطة + خريطة المستهلك */
export function computeProgress(
  our: StatementLineFull[],
  their: StatementLineFull[],
  groups: MatchGroup[],
  consumed: Map<number, number>,
): SessionProgress {
  const active = new Set(groups.filter((g) => g.isActive).map((g) => g.id));
  const confirmed = new Set(groups.filter((g) => g.isActive && g.status === 'confirmed').map((g) => g.id));

  const side = (lines: StatementLineFull[]): SideProgress => {
    let total = 0;
    const lineCount = lines.length;
    let matchedConfirmedAmt = 0;
    let matchedSuggestedAmt = 0;
    let leftover = 0;
    let leftoverCount = 0;
    for (const l of lines) {
      const abs = Math.abs(l.signed);
      total += abs;
      const used = consumed.get(l.id) ?? 0;
      const remaining = Math.max(0, abs - used);
      leftover += remaining;
      if (remaining > EPS) leftoverCount += 1;
    }
    for (const g of groups) {
      if (!active.has(g.id)) continue;
      for (const item of g.items) {
        const line = lines.find((l) => l.id === item.lineId);
        if (!line) continue;
        const portion = Math.abs(item.allocated ?? line.signed);
        if (confirmed.has(g.id)) matchedConfirmedAmt += portion;
        else matchedSuggestedAmt += portion;
      }
    }
    return { lineCount, total, matchedConfirmed: matchedConfirmedAmt, matchedSuggested: matchedSuggestedAmt, leftover, leftoverCount };
  };

  const ours = side(our);
  const theirs = side(their);
  const matchRatePct = theirs.total > EPS ? (theirs.matchedConfirmed / theirs.total) * 100 : ours.total > EPS ? (ours.matchedConfirmed / ours.total) * 100 : 100;
  return { ours, theirs, matchRatePct };
}

export class SessionService {
  constructor(
    private readonly pool: Pool,
    private readonly sessions: SessionsRepository,
    private readonly accounts: AccountsRepository,
    private readonly matches: MatchesRepository,
    private readonly audit: AuditRepository,
    private readonly discrepancies: DiscrepanciesRepository,
  ) {}

  async create(
    actorId: number,
    input: {
      accountId: number;
      periodLabel: string;
      openingBalance?: number | null;
      openingTheirs?: number | null;
      carriedFromSessionId?: number | null;
      openingAdjustReason?: string | null;
    },
    ip: string | null,
  ): Promise<ReconciliationSession> {
    if (!/^\d{4}-\d{2}$/.test(input.periodLabel)) {
      throw ERR.VALIDATION([{ field: 'periodLabel', messageAr: 'صيغة الفترة YYYY-MM — مثال 2026-06' }]);
    }
    const account = await this.accounts.getById(input.accountId);
    if (!account) throw ERR.PARTNER_NOT_FOUND();
    if (!account.isActive) throw ERR.VALIDATION([{ field: 'accountId', messageAr: 'حساب المورد معطل — فعّله أولاً' }]);

    const conflict = await this.sessions.findOpenByAccountPeriod(input.accountId, input.periodLabel);
    if (conflict) throw ERR.SESSION_EXISTS(conflict.id);

    // === الترحيل الآلي (D9): تحقق خادمي صارم — السبب إجباري عند أي تعديل يدوي ===
    let carriedFrom: number | null = null;
    let adjustReason: string | null = null;
    let openingOurs = input.openingBalance ?? null;
    let openingTheirs = input.openingTheirs ?? null;

    if (input.carriedFromSessionId) {
      const src = await this.sessions.getById(input.carriedFromSessionId);
      if (!src || src.status !== 'closed') {
        throw ERR.VALIDATION([{ field: 'carriedFromSessionId', messageAr: 'جلسة الترحيل غير موجودة أو ليست مغلقة' }]);
      }
      if (src.accountId !== input.accountId) {
        throw ERR.VALIDATION([{ field: 'carriedFromSessionId', messageAr: 'الترحيل من جلسات نفس الحساب فقط' }]);
      }
      const closings = await this.sessions.closingsOfSession(src.id);
      if (!closings || !closings.hasLines) {
        throw ERR.VALIDATION([{ field: 'carriedFromSessionId', messageAr: 'لا بنود موثقة في الجلسة السابقة — لا شيء يُرحَّل (أدخل الافتتاحي يدوياً)' }]);
      }
      carriedFrom = src.id;
      const EPS = 0.005;
      // تعديل = قيمة مرسلة تخالف الختامي المحسوب، أو تفريغ حقل كان سيُرحَّل بقيمة غير صفر
      const oursEdited =
        openingOurs == null ? Math.abs(closings.closingOurs) > EPS : Math.abs(openingOurs - closings.closingOurs) > EPS;
      const theirsEdited =
        openingTheirs == null
          ? Math.abs(closings.closingTheirs) > EPS
          : Math.abs(openingTheirs - closings.closingTheirs) > EPS;
      if (oursEdited || theirsEdited) {
        const reason = (input.openingAdjustReason ?? '').trim();
        if (reason.length < 5) {
          throw ERR.VALIDATION([
            {
              field: 'openingAdjustReason',
              messageAr: 'عدّلت الرصيد المرحَّل يدوياً — سبب التعديل إجباري (5 أحرف على الأقل) حفاظاً على التوثيق الكامل',
            },
          ]);
        }
        adjustReason = reason;
      }
    }

    const session = await this.sessions.create({
      accountId: input.accountId,
      currencyCode: account.currencyCode,
      periodLabel: input.periodLabel,
      openingOurs,
      openingTheirs,
      carriedFromSessionId: carriedFrom,
      openingAdjustReason: adjustReason,
      createdBy: actorId,
    });
    await this.audit.write({
      actorId,
      action: 'SESSION_CREATE',
      entityType: 'session',
      entityId: String(session.id),
      after: {
        accountId: input.accountId,
        period: input.periodLabel,
        carriedFrom,
        adjusted: adjustReason != null,
        adjustReason,
      },
      ip,
    });
    return session;
  }

  /**
   * تعديل جلسة مفتوحة (طلب المالك): الفترة والافتتاحيان — المغلقة وثيقة لا تُمس.
   * نفس قاعدة D9: تعديل المرحَّل يستلزم سبباً (5 أحرف على الأقل).
   */
  async updateOpen(
    actorId: number,
    id: number,
    patch: { periodLabel?: string; openingOurs?: number | null; openingTheirs?: number | null; openingAdjustReason?: string | null },
    ip: string | null,
  ): Promise<ReconciliationSession> {
    const session = await this.sessions.getById(id);
    if (!session) throw ERR.NOT_FOUND();
    if (session.status === 'closed') {
      throw ERR.VALIDATION([{ field: 'status', messageAr: 'الجلسة مغلقة — وثيقة الإقفال لا تُعدَّل، أعد فتحها أولاً (أدمن)' }]);
    }
    if (patch.periodLabel !== undefined) {
      if (!/^\d{4}-\d{2}$/.test(patch.periodLabel)) {
        throw ERR.VALIDATION([{ field: 'periodLabel', messageAr: 'صيغة الفترة YYYY-MM — مثال 2026-06' }]);
      }
      const conflict = await this.sessions.findOpenByAccountPeriod(session.accountId, patch.periodLabel);
      if (conflict && conflict.id !== id) {
        throw ERR.SESSION_EXISTS(conflict.id);
      }
    }
    // قاعدة السبب: مرحَّل آلياً + تغيّر أي افتتاحي عن المحفوظ → سبب إجباري
    const openingsTouched =
      (patch.openingOurs !== undefined && patch.openingOurs !== session.openingOurs) ||
      (patch.openingTheirs !== undefined && patch.openingTheirs !== session.openingTheirs);
    if (session.carriedFromSessionId != null && openingsTouched) {
      const reason = (patch.openingAdjustReason ?? '').trim();
      if (reason.length < 5) {
        throw ERR.VALIDATION([
          { field: 'openingAdjustReason', messageAr: 'عدّلت الرصيد المرحَّل — سبب التعديل إجباري (5 أحرف على الأقل)' },
        ]);
      }
      patch.openingAdjustReason = reason;
    }
    const updated = await this.sessions.updateOpen(id, patch);
    if (!updated) throw ERR.NOT_FOUND();
    await this.audit.write({
      actorId,
      action: 'SESSION_UPDATE',
      entityType: 'session',
      entityId: String(id),
      after: patch,
      ip,
    });
    return updated;
  }

  /** حذف جلسة فارغة تماماً (بلا كشوف وبلا فروق) — أدمن فقط، بتنبيه في الواجهة */
  async remove(actorId: number, id: number, ip: string | null): Promise<{ ok: true }> {
    const session = await this.sessions.getById(id);
    if (!session) throw ERR.NOT_FOUND();
    if (session.status === 'closed') {
      // وثيقة الإقفال لا تُحذف — إعادة الفتح أولاً إن لزم (تدقيق كامل)
      throw ERR.VALIDATION([
        { field: 'status', messageAr: 'الجلسة مغلقة — وثيقة إقفال موثقة لا تُحذف؛ أعد فتحها أولاً إن أردت التخلص منها' },
      ]);
    }
    const res = await this.sessions.deleteIfEmpty(id);
    if (!res.ok) {
      const msg =
        res.reason === 'has_statements'
          ? 'لا تُحذف الجلسة — عليها كشوف معتمدة. احذف/انقل الكشوف أولاً، أو أغلق الجلسة لتوثيقها'
          : res.reason === 'has_discrepancies'
            ? 'لا تُحذف الجلسة — عليها فروق مسجلة. عالج الفروق أو رحّلها أولاً'
            : 'الجلسة غير موجودة';
      throw ERR.VALIDATION([{ field: 'id', messageAr: msg }]);
    }
    await this.audit.write({
      actorId,
      action: 'SESSION_DELETE',
      entityType: 'session',
      entityId: String(id),
      before: { period: session.periodLabel, accountId: session.accountId, status: session.status },
      ip,
    });
    return { ok: true };
  }

  /**
   * اقتراح الافتتاحي (D9): ختاميا آخر جلسة مغلقة لنفس الحساب محسوبان من بنودها
   * الموثقة — بلا بنود لا اقتراح (لا نرحّل أصفاراً زائفة).
   */
  async openingSuggestion(accountId: number) {
    const account = await this.accounts.getById(accountId);
    if (!account) throw ERR.PARTNER_NOT_FOUND();
    const lastId = await this.sessions.lastClosedId(accountId);
    if (!lastId) return null;
    const closings = await this.sessions.closingsOfSession(lastId);
    if (!closings || !closings.hasLines) return null;
    const periodLabel = await this.sessions.periodLabelOf(lastId);
    const closedSession = await this.sessions.getById(lastId);
    return {
      fromSessionId: lastId,
      periodLabel,
      closedAt: closedSession?.closedAt ?? null,
      closingOurs: Math.round(closings.closingOurs * 10000) / 10000,
      closingTheirs: Math.round(closings.closingTheirs * 10000) / 10000,
    };
  }

  /** قائمة الجلسات مع نسبة التقدم (أولويتها القراءة — الحساب لكل جلسة مستقل) */
  async list(status?: string): Promise<Array<SessionWithPartner & { progress: SessionProgress }>> {
    const rows = await this.sessions.list(status);
    const out = [];
    for (const s of rows) {
      const progress = await this.progressOf(s.id);
      out.push({ ...s, progress });
    }
    return out;
  }

  /** تفصيل الجلسة الكامل — وقود شاشة عمل المطابقة في نداء واحد */
  async detail(id: number) {
    const session = await this.sessions.getWithPartner(id);
    if (!session) throw ERR.NOT_FOUND();
    const { our, their } = await this.matches.sessionLines(id);
    const groups = await this.matches.groups(id);
    const consumed = await this.matches.consumedMap(id);
    const progress = computeProgress(our, their, groups, consumed);

    const withRemaining = (lines: StatementLineFull[]) =>
      lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        entryDate: l.entryDate,
        docType: l.docType,
        docNo: l.docNo,
        description: l.description,
        ref: l.ourRef ?? l.theirRef ?? '',
        debit: l.debit,
        credit: l.credit,
        signed: l.signed,
        remaining: Math.max(0, Math.abs(l.signed) - (consumed.get(l.id) ?? 0)),
      }));

    const statements = await this.statementsOf(id);
    return {
      session: {
        id: session.id,
        status: session.status,
        periodLabel: session.periodLabel,
        currencyCode: session.currencyCode,
        openingOurs: session.openingOurs,
        openingTheirs: session.openingTheirs,
        carriedFromSessionId: session.carriedFromSessionId,
        carriedFromPeriod:
          session.carriedFromSessionId != null
            ? await this.sessions.periodLabelOf(session.carriedFromSessionId)
            : null,
        openingAdjustReason: session.openingAdjustReason,
        createdAt: session.createdAt,
        closedAt: session.closedAt,
        closeSummary: session.closeSummary,
      },
      partner: session.partner,
      ourStatement: statements.our ? { ...statements.our, lines: withRemaining(our) } : null,
      theirStatement: statements.their ? { ...statements.their, lines: withRemaining(their) } : null,
      groups,
      progress,
    };
  }

  private async statementsOf(sessionId: number) {
    const { rows } = await this.pool.query<{
      id: string | number;
      our: string | number | null;
      their: string | number | null;
      period_start: Date | string | null;
      period_end: Date | string | null;
      opening_balance: string | null;
      closing_balance: string | null;
      file_name: string | null;
    }>(
      `SELECT s.id, ses.our_statement_id AS ours, ses.their_statement_id AS theirs,
              s.period_start, s.period_end, s.opening_balance, s.closing_balance,
              f.original_name AS file_name
       FROM reconciliation_sessions ses
       JOIN statements s ON s.id IN (ses.our_statement_id, ses.their_statement_id)
       LEFT JOIN source_files f ON f.id = s.source_file_id
       WHERE ses.id = $1`,
      [sessionId],
    );
    const map = new Map<number, { id: number; periodStart: string | null; periodEnd: string | null; opening: number | null; closing: number | null; fileName: string | null }>();
    for (const r of rows) {
      map.set(Number(r.id), {
        id: Number(r.id),
        periodStart: r.period_start == null ? null : r.period_start instanceof Date ? r.period_start.toISOString().slice(0, 10) : String(r.period_start).slice(0, 10),
        periodEnd: r.period_end == null ? null : r.period_end instanceof Date ? r.period_end.toISOString().slice(0, 10) : String(r.period_end).slice(0, 10),
        opening: r.opening_balance == null ? null : Number(r.opening_balance),
        closing: r.closing_balance == null ? null : Number(r.closing_balance),
        fileName: r.file_name,
      });
    }
    const ses = await this.sessions.getById(sessionId);
    return {
      our: ses?.ourStatementId ? map.get(ses.ourStatementId) ?? null : null,
      their: ses?.theirStatementId ? map.get(ses.theirStatementId) ?? null : null,
    };
  }

  async progressOf(sessionId: number): Promise<SessionProgress> {
    const { our, their } = await this.matches.sessionLines(sessionId);
    const groups = await this.matches.groups(sessionId);
    const consumed = await this.matches.consumedMap(sessionId);
    return computeProgress(our, their, groups, consumed);
  }

  /** إغلاق الجلسة: لقطة ملخص (نسبة + متبقٍ مصنف) — الجلسة المغلقة تتجمد */
  async close(actorId: number, id: number, ip: string | null) {
    const session = await this.sessions.getById(id);
    if (!session) throw ERR.NOT_FOUND();
    if (session.status === 'closed') {
      throw ERR.VALIDATION([{ field: 'status', messageAr: 'الجلسة مغلقة مسبقاً' }]);
    }
    const progress = await this.progressOf(id);
    const { our, their } = await this.matches.sessionLines(id);
    const consumed = await this.matches.consumedMap(id);

    const discrepancies: CloseDiscrepancy[] = [];
    const collect = (lines: StatementLineFull[], type: 'ours_only' | 'theirs_only') => {
      for (const l of lines) {
        const remaining = Math.max(0, Math.abs(l.signed) - (consumed.get(l.id) ?? 0));
        if (remaining > EPS) {
          discrepancies.push({ type, lineId: l.id, lineNo: l.lineNo, date: l.entryDate, description: l.description, amount: remaining });
        }
      }
    };
    collect(our, 'ours_only');
    collect(their, 'theirs_only');

    const summary = {
      matchRatePct: Number(progress.matchRatePct.toFixed(2)),
      totals: { ours: progress.ours, theirs: progress.theirs },
      discrepancies,
      closedBy: actorId,
    };
    await this.sessions.close(id, summary);
    // الوحدة 5: البنود المتبقية تصبح صفوف فروق حقيقية تديرها الجلسة التالية
    await this.discrepancies.regenerateForClose(
      id,
      discrepancies.map((d): { type: 'ours_only' | 'theirs_only'; lineId: number; amount: number } => ({
        type: d.type,
        lineId: d.lineId,
        amount: d.amount,
      })),
    );
    await this.audit.write({
      actorId,
      action: 'SESSION_CLOSE',
      entityType: 'session',
      entityId: String(id),
      after: { matchRatePct: summary.matchRatePct, discrepancies: discrepancies.length },
      ip,
    });
    return summary;
  }

  /** إعادة فتح (أدمن فقط — تُدقَّق في السجل) */
  async reopen(actorId: number, id: number, ip: string | null) {
    const session = await this.sessions.getById(id);
    if (!session) throw ERR.NOT_FOUND();
    if (session.status !== 'closed') {
      throw ERR.VALIDATION([{ field: 'status', messageAr: 'الجلسة ليست مغلقة' }]);
    }
    await this.sessions.reopen(id);
    await this.audit.write({
      actorId,
      action: 'SESSION_REOPEN',
      entityType: 'session',
      entityId: String(id),
      after: {},
      ip,
    });
    return this.sessions.getById(id);
  }
}
