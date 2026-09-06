import type { Pool } from 'pg';
import { ERR } from '../../domain/errors.js';

/**
 * مستودع الفروق (Module 5) — جدول discrepancies.
 * تُولَّد آلياً عند إغلاق الجلسة من البنود المتبقية (ours_only/theirs_only)،
 * ويعمل عليها الفريق: سبب + مسؤول + حالة + ملاحظة حل + ترحيل للجلسة التالية.
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
  currencyCode: string;
  accountId: number;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string | number;
  session_id: string | number;
  discrepancy_type: DiscrepancyType;
  our_line_id: string | number | null;
  their_line_id: string | number | null;
  our_amount: string | null;
  their_amount: string | null;
  diff_amount: string | null;
  reason_code_id: string | number | null;
  reason_name: string | null;
  assignee_id: string | number | null;
  assignee_name: string | null;
  status: DiscrepancyStatus;
  resolution_note: string | null;
  carried_to_session_id: string | number | null;
  line_description: string | null;
  line_date: Date | string | null;
  partner_name: string;
  period_label: string;
  currency_code: string;
  account_id: string | number;
  created_at: Date;
  updated_at: Date;
}

const iso = (d: Date | string | null): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : String(d);

const toFull = (r: Row): DiscrepancyFull => ({
  id: Number(r.id),
  sessionId: Number(r.session_id),
  type: r.discrepancy_type,
  ourLineId: r.our_line_id == null ? null : Number(r.our_line_id),
  theirLineId: r.their_line_id == null ? null : Number(r.their_line_id),
  ourAmount: r.our_amount == null ? null : Number(r.our_amount),
  theirAmount: r.their_amount == null ? null : Number(r.their_amount),
  diffAmount: r.diff_amount == null ? null : Number(r.diff_amount),
  reasonCodeId: r.reason_code_id == null ? null : Number(r.reason_code_id),
  reasonCodeName: r.reason_name,
  assigneeId: r.assignee_id == null ? null : Number(r.assignee_id),
  assigneeName: r.assignee_name,
  status: r.status,
  resolutionNote: r.resolution_note,
  carriedToSessionId: r.carried_to_session_id == null ? null : Number(r.carried_to_session_id),
  lineDescription: r.line_description,
  lineDate: iso(r.line_date)?.slice(0, 10) ?? null,
  partnerName: r.partner_name,
  periodLabel: r.period_label,
  currencyCode: r.currency_code,
  accountId: Number(r.account_id),
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
});

export interface CloseDiscrepancyInput {
  type: 'ours_only' | 'theirs_only';
  lineId: number;
  amount: number;
}

export class DiscrepanciesRepository {
  constructor(private readonly pool: Pool) {}

  async list(filters: { sessionId?: number; status?: string; accountId?: number }): Promise<DiscrepancyFull[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.sessionId) {
      params.push(filters.sessionId);
      where.push(`d.session_id = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      where.push(`d.status = $${params.length}`);
    }
    if (filters.accountId) {
      params.push(filters.accountId);
      where.push(`s.account_id = $${params.length}`);
    }
    const { rows } = await this.pool.query<Row>(
      `SELECT d.*,
              rc.name_ar AS reason_name,
              u.full_name AS assignee_name,
              p.name_ar AS partner_name,
              s.period_label, s.currency_code, s.account_id,
              ol.description AS line_description, ol.entry_date AS line_date
       FROM discrepancies d
       JOIN reconciliation_sessions s ON s.id = d.session_id
       JOIN accounts a ON a.id = s.account_id
       JOIN partners p ON p.id = a.partner_id
       LEFT JOIN reason_codes rc ON rc.id = d.reason_code_id
       LEFT JOIN users u ON u.id = d.assignee_id
       LEFT JOIN statement_lines ol ON ol.id = COALESCE(d.our_line_id, d.their_line_id)
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY d.id DESC`,
      params,
    );
    return rows.map(toFull);
  }

  /**
   * توليد الإغلاق: يمدّ البنود المتبقية صفوفاً. قبل الإدراج يُحذف ما وُلِّد سابقاً
   * ولم يلمسه أحد (جديد بلا مسؤول/سبب/ملاحظة) — عمل الإنسان المحفوظ لا يُمس.
   */
  async regenerateForClose(sessionId: number, items: CloseDiscrepancyInput[]): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM discrepancies
         WHERE session_id = $1 AND status = 'new' AND assignee_id IS NULL
           AND reason_code_id IS NULL AND resolution_note IS NULL AND carried_to_session_id IS NULL`,
        [sessionId],
      );
      for (const it of items) {
        const lineCol = it.type === 'ours_only' ? 'our_line_id' : 'their_line_id';
        const amountCol = it.type === 'ours_only' ? 'our_amount' : 'their_amount';
        await client.query(
          `INSERT INTO discrepancies (session_id, discrepancy_type, ${lineCol}, ${amountCol}, diff_amount)
           VALUES ($1, $2, $3, $4, $4)`,
          [sessionId, it.type, it.lineId, it.amount],
        );
      }
      await client.query('COMMIT');
      return items.length;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async update(
    id: number,
    patch: { status?: DiscrepancyStatus; assigneeId?: number | null; reasonCodeId?: number | null; resolutionNote?: string | null },
  ): Promise<boolean> {
    const sets: string[] = ['updated_at = now()'];
    const params: unknown[] = [];
    if (patch.status !== undefined) {
      params.push(patch.status);
      sets.push(`status = $${params.length}`);
    }
    if (patch.assigneeId !== undefined) {
      params.push(patch.assigneeId);
      sets.push(`assignee_id = $${params.length}`);
    }
    if (patch.reasonCodeId !== undefined) {
      params.push(patch.reasonCodeId);
      sets.push(`reason_code_id = $${params.length}`);
    }
    if (patch.resolutionNote !== undefined) {
      params.push(patch.resolutionNote);
      sets.push(`resolution_note = $${params.length}`);
    }
    params.push(id);
    let res;
    try {
      res = await this.pool.query(
        `UPDATE discrepancies SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
      );
    } catch (e) {
      // مفتاح أجنبي: مسؤول أو سبب غير موجود — رسالة عمل لا 500
      if ((e as { code?: string }).code === '23503') {
        throw ERR.VALIDATION([{ field: 'assigneeId', messageAr: 'المسؤول أو السبب المختار غير موجود — حدّث القائمة' }]);
      }
      throw e;
    }
    if ((res.rowCount ?? 0) > 0 && patch.status && ['resolved', 'accepted'].includes(patch.status)) {
      await this.pool.query('UPDATE discrepancies SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL', [id]);
    }
    return (res.rowCount ?? 0) > 0;
  }

  async setCarried(id: number, targetSessionId: number): Promise<boolean> {
    const res = await this.pool.query(
      'UPDATE discrepancies SET carried_to_session_id = $2, updated_at = now() WHERE id = $1',
      [id, targetSessionId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async getById(id: number): Promise<{ sessionId: number; accountId: number; carriedToSessionId: number | null } | null> {
    const { rows } = await this.pool.query<{ id: string | number; session_id: string | number; account_id: string | number; carried: string | number | null }>(
      `SELECT d.id, d.session_id, s.account_id, d.carried_to_session_id AS carried
       FROM discrepancies d JOIN reconciliation_sessions s ON s.id = d.session_id
       WHERE d.id = $1`,
      [id],
    );
    if (!rows[0]) return null;
    return {
      sessionId: Number(rows[0].session_id),
      accountId: Number(rows[0].account_id),
      carriedToSessionId: rows[0].carried == null ? null : Number(rows[0].carried),
    };
  }

  async listReasonCodes(): Promise<Array<{ id: number; code: string; nameAr: string }>> {
    const { rows } = await this.pool.query<{ id: string | number; code: string; name_ar: string }>(
      'SELECT id, code, name_ar FROM reason_codes WHERE is_active ORDER BY sort_order',
    );
    return rows.map((r) => ({ id: Number(r.id), code: r.code, nameAr: r.name_ar }));
  }

  // ===== تعليقات الفروق (Module 7) — دفتر ملاحظات مثبّت بجانب كل فرق =====

  private readonly commentSelect = `
    SELECT c.id, c.discrepancy_id, c.author_id, u.full_name AS author_name, u.role AS author_role,
           c.comment, c.created_at
    FROM discrepancy_comments c JOIN users u ON u.id = c.author_id`;

  private toComment(r: { id: string | number; discrepancy_id: string | number; author_id: string | number; author_name: string; author_role: string; comment: string; created_at: Date | string }) {
    return {
      id: Number(r.id),
      discrepancyId: Number(r.discrepancy_id),
      authorId: Number(r.author_id),
      authorName: r.author_name,
      authorRole: r.author_role,
      body: r.comment,
      createdAt: iso(r.created_at)!,
    };
  }

  async listComments(discrepancyId: number) {
    const { rows } = await this.pool.query(`${this.commentSelect} WHERE c.discrepancy_id = $1 ORDER BY c.id`, [discrepancyId]);
    return rows.map((r) => this.toComment(r));
  }

  /** تعليقات كل فروق جلسة — لطباعة تقرير الجلسة (الملاحظات تحت كل فرق) */
  async listSessionComments(sessionId: number) {
    const { rows } = await this.pool.query(
      `${this.commentSelect} JOIN discrepancies d ON d.id = c.discrepancy_id WHERE d.session_id = $1 ORDER BY c.id`,
      [sessionId],
    );
    return rows.map((r) => this.toComment(r));
  }

  async addComment(discrepancyId: number, authorId: number, body: string) {
    const { rows } = await this.pool.query<{ id: string | number }>(
      'INSERT INTO discrepancy_comments (discrepancy_id, author_id, comment) VALUES ($1, $2, $3) RETURNING id',
      [discrepancyId, authorId, body],
    );
    const { rows: full } = await this.pool.query(`${this.commentSelect} WHERE c.id = $1`, [rows[0].id]);
    return this.toComment(full[0]);
  }

  async getComment(id: number): Promise<{ id: number; discrepancyId: number; authorId: number } | null> {
    const { rows } = await this.pool.query<{ id: string | number; discrepancy_id: string | number; author_id: string | number }>(
      'SELECT id, discrepancy_id, author_id FROM discrepancy_comments WHERE id = $1',
      [id],
    );
    if (!rows[0]) return null;
    return { id: Number(rows[0].id), discrepancyId: Number(rows[0].discrepancy_id), authorId: Number(rows[0].author_id) };
  }

  async deleteComment(id: number): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM discrepancy_comments WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }
}
