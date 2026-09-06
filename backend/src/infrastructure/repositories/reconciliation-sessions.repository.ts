import type { Pool } from 'pg';

/**
 * مستودع جلسات المطابقة (Module 4) — جدول reconciliation_sessions.
 * تمييزاً عن جلسات الدخول (sessions.repository = auth_sessions):
 * هذه جلسة عمل «مطابقة كشف مورد مقابل أونكس» لفترة وحساب.
 * الجلسة تُنشأ أولاً (المعالج خطوة 1) وترتبط بها الكشوفات عند اعتمادها
 * (our/their_statement_id يملآن مرة واحدة لكل جهة).
 */

interface SessionRow {
  id: string | number;
  account_id: string | number;
  currency_code: string;
  period_label: string;
  our_statement_id: string | number | null;
  their_statement_id: string | number | null;
  status: 'in_progress' | 'closed' | 'reopened';
  opening_our_balance: string | null;
  opening_their_balance: string | null;
  carried_from_session_id: string | number | null;
  opening_adjust_reason: string | null;
  created_by: string | number | null;
  created_at: Date;
  closed_at: Date | null;
  close_summary: unknown;
}

export type SessionStatus = 'in_progress' | 'closed' | 'reopened';

export interface ReconciliationSession {
  id: number;
  accountId: number;
  currencyCode: string;
  periodLabel: string;
  ourStatementId: number | null;
  theirStatementId: number | null;
  status: SessionStatus;
  openingOurs: number | null;
  openingTheirs: number | null;
  /** الجلسة المصدر للترحيل الآلي (D9) — null = إدخال يدوي بلا جلسة سابقة */
  carriedFromSessionId: number | null;
  /** سبب التعديل الإجباري إن اختلفت القيم المرحَّلة (قرار المالك) */
  openingAdjustReason: string | null;
  createdAt: string;
  closedAt: string | null;
  closeSummary: unknown;
}

const toSession = (r: SessionRow): ReconciliationSession => ({
  id: Number(r.id),
  accountId: Number(r.account_id),
  currencyCode: r.currency_code,
  periodLabel: r.period_label,
  ourStatementId: r.our_statement_id == null ? null : Number(r.our_statement_id),
  theirStatementId: r.their_statement_id == null ? null : Number(r.their_statement_id),
  status: r.status,
  openingOurs: r.opening_our_balance == null ? null : Number(r.opening_our_balance),
  openingTheirs: r.opening_their_balance == null ? null : Number(r.opening_their_balance),
  carriedFromSessionId: r.carried_from_session_id == null ? null : Number(r.carried_from_session_id),
  openingAdjustReason: r.opening_adjust_reason ?? null,
  createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  closedAt: r.closed_at == null ? null : r.closed_at instanceof Date ? r.closed_at.toISOString() : String(r.closed_at),
  closeSummary: r.close_summary ?? null,
});

interface SessionMetaRow extends SessionRow {
  partner_id: string | number;
  partner_code: string;
  partner_name: string;
}

export interface SessionWithPartner extends ReconciliationSession {
  partner: { id: number; code: string; nameAr: string };
}

const toWithPartner = (r: SessionMetaRow): SessionWithPartner => ({
  ...toSession(r),
  partner: { id: Number(r.partner_id), code: r.partner_code, nameAr: r.partner_name },
});

export class SessionsRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: {
    accountId: number;
    currencyCode: string;
    periodLabel: string;
    openingOurs: number | null;
    openingTheirs: number | null;
    carriedFromSessionId: number | null;
    openingAdjustReason: string | null;
    createdBy: number;
  }): Promise<ReconciliationSession> {
    const { rows } = await this.pool.query<SessionRow>(
      `INSERT INTO reconciliation_sessions
         (account_id, currency_code, period_label, opening_our_balance, opening_their_balance,
          carried_from_session_id, opening_adjust_reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        input.accountId,
        input.currencyCode,
        input.periodLabel,
        input.openingOurs,
        input.openingTheirs,
        input.carriedFromSessionId,
        input.openingAdjustReason,
        input.createdBy,
      ],
    );
    return toSession(rows[0]);
  }

  /**
   * ختاميات جلسة مغلقة محسوبة من بنودها الموثقة (صفر تسامح — لا أرقام معلنة):
   * ختامنا = افتتاحيهم + دائن − مدين (اتجاه حساب الموردين عندنا)،
   * وختامهم = افتتاحيهم + مدين − دائن — نفس معادلة التحقق في الاعتماد.
   */
  async closingsOfSession(id: number): Promise<{ closingOurs: number; closingTheirs: number; hasLines: boolean } | null> {
    const { rows } = await this.pool.query<{
      opening_ours: string | null;
      opening_theirs: string | null;
      ours_flow: string | null;
      theirs_flow: string | null;
      has_lines: boolean;
    }>(
      `SELECT COALESCE(s.opening_our_balance, so.opening_balance, 0)  AS opening_ours,
              COALESCE(s.opening_their_balance, st.opening_balance, 0) AS opening_theirs,
              (SELECT COALESCE(SUM(l.credit), 0) - COALESCE(SUM(l.debit), 0)
                 FROM statement_lines l WHERE l.statement_id = s.our_statement_id)   AS ours_flow,
              (SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0)
                 FROM statement_lines l WHERE l.statement_id = s.their_statement_id) AS theirs_flow,
              (s.our_statement_id IS NOT NULL OR s.their_statement_id IS NOT NULL)   AS has_lines
       FROM reconciliation_sessions s
       LEFT JOIN statements so ON so.id = s.our_statement_id
       LEFT JOIN statements st ON st.id = s.their_statement_id
       WHERE s.id = $1`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      closingOurs: Number(r.opening_ours ?? 0) + Number(r.ours_flow ?? 0),
      closingTheirs: Number(r.opening_theirs ?? 0) + Number(r.theirs_flow ?? 0),
      hasLines: r.has_lines === true,
    };
  }

  /** آخر جلسة مغلقة لحساب — مرشّح الترحيل الآلي */
  async lastClosedId(accountId: number): Promise<number | null> {
    const { rows } = await this.pool.query<{ id: string | number }>(
      `SELECT id FROM reconciliation_sessions
       WHERE account_id = $1 AND status = 'closed'
       ORDER BY closed_at DESC NULLS LAST, id DESC LIMIT 1`,
      [accountId],
    );
    return rows[0] ? Number(rows[0].id) : null;
  }

  /**
   * تعديل جلسة مفتوحة (فترة/افتتاحيان) — الجلسات المغلقة وثائق لا تُمس.
   * patch جزئي: نحدّث الموجود فقط.
   */
  async updateOpen(
    id: number,
    patch: { periodLabel?: string; openingOurs?: number | null; openingTheirs?: number | null; openingAdjustReason?: string | null },
  ): Promise<ReconciliationSession | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.periodLabel !== undefined) {
      params.push(patch.periodLabel);
      sets.push(`period_label = $${params.length}`);
    }
    if (patch.openingOurs !== undefined) {
      params.push(patch.openingOurs);
      sets.push(`opening_our_balance = $${params.length}`);
    }
    if (patch.openingTheirs !== undefined) {
      params.push(patch.openingTheirs);
      sets.push(`opening_their_balance = $${params.length}`);
    }
    if (patch.openingAdjustReason !== undefined) {
      params.push(patch.openingAdjustReason);
      sets.push(`opening_adjust_reason = $${params.length}`);
    }
    if (!sets.length) return this.getById(id);
    params.push(id);
    const { rows } = await this.pool.query<SessionRow>(
      `UPDATE reconciliation_sessions SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  /** حذف جلسة — مسموح فقط إن خلت من كشوف وفروق (حماية سجل المحاسبة) */
  async deleteIfEmpty(id: number): Promise<{ ok: boolean; reason?: 'has_statements' | 'has_discrepancies' | 'not_found' }> {
    const sess = await this.getById(id);
    if (!sess) return { ok: false, reason: 'not_found' };
    if (sess.ourStatementId != null || sess.theirStatementId != null) {
      return { ok: false, reason: 'has_statements' };
    }
    const disc = await this.pool.query('SELECT 1 FROM discrepancies WHERE session_id = $1 LIMIT 1', [id]);
    if (disc.rowCount) {
      return { ok: false, reason: 'has_discrepancies' };
    }
    // من يُحال إليها (ترحيل افتتاحي أو فرق مُرحَّل) يُفك قبل الحذف
    await this.pool.query('UPDATE reconciliation_sessions SET carried_from_session_id = NULL WHERE carried_from_session_id = $1', [id]);
    await this.pool.query('UPDATE discrepancies SET carried_to_session_id = NULL WHERE carried_to_session_id = $1', [id]);
    await this.pool.query('DELETE FROM reconciliation_sessions WHERE id = $1', [id]);
    return { ok: true };
  }

  async periodLabelOf(id: number): Promise<string | null> {
    const { rows } = await this.pool.query<{ period_label: string }>(
      'SELECT period_label FROM reconciliation_sessions WHERE id = $1',
      [id],
    );
    return rows[0]?.period_label ?? null;
  }

  /** جلسة مفتوحة (قيد العمل أو معاد فتحها) لنفس الحساب والفترة — كشف التعارض */
  async findOpenByAccountPeriod(accountId: number, periodLabel: string): Promise<ReconciliationSession | null> {
    const { rows } = await this.pool.query<SessionRow>(
      `SELECT * FROM reconciliation_sessions
       WHERE account_id = $1 AND period_label = $2 AND status IN ('in_progress','reopened')
       ORDER BY id DESC LIMIT 1`,
      [accountId, periodLabel],
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  async getById(id: number): Promise<ReconciliationSession | null> {
    const { rows } = await this.pool.query<SessionRow>(
      'SELECT * FROM reconciliation_sessions WHERE id = $1',
      [id],
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  async getWithPartner(id: number): Promise<SessionWithPartner | null> {
    const { rows } = await this.pool.query<SessionMetaRow>(
      `SELECT s.*, p.id AS partner_id, p.code AS partner_code, p.name_ar AS partner_name
       FROM reconciliation_sessions s
       JOIN accounts a ON a.id = s.account_id
       JOIN partners p ON p.id = a.partner_id
       WHERE s.id = $1`,
      [id],
    );
    return rows[0] ? toWithPartner(rows[0]) : null;
  }

  async list(status?: string): Promise<SessionWithPartner[]> {
    const { rows } = await this.pool.query<SessionMetaRow>(
      `SELECT s.*, p.id AS partner_id, p.code AS partner_code, p.name_ar AS partner_name
       FROM reconciliation_sessions s
       JOIN accounts a ON a.id = s.account_id
       JOIN partners p ON p.id = a.partner_id
       ${status ? 'WHERE s.status = $1' : ''}
       ORDER BY s.id DESC`,
      status ? [status] : [],
    );
    return rows.map(toWithPartner);
  }

  async close(id: number, summary: unknown): Promise<void> {
    await this.pool.query(
      `UPDATE reconciliation_sessions
       SET status = 'closed', closed_at = now(), close_summary = $2::jsonb
       WHERE id = $1`,
      [id, JSON.stringify(summary)],
    );
  }

  async reopen(id: number): Promise<void> {
    await this.pool.query(
      `UPDATE reconciliation_sessions
       SET status = 'reopened', closed_at = NULL, close_summary = NULL
       WHERE id = $1`,
      [id],
    );
  }
}
