import type { Pool } from 'pg';
import { ERR } from '../../domain/errors.js';

/**
 * مستودع الكشوفات — الإنشاء بمعاملة واحدة: ملف + كشف + بنوده (كلها أو لا شيء).
 * signed_amount يُحسب بالخادم حسب الجهة (مطابق لمحرك المطابقة):
 * كشفنا: دائن − مدين · كشفهم: مدين − دائن. استخراج المراجع من البيان+\u200frefs.
 */

export interface StatementLineInput {
  lineNo: number;
  entryDate: string; // YYYY-MM-DD (محلَّل)
  description: string;
  ourRef?: string | null;
  theirRef?: string | null;
  debit?: number | null;
  credit?: number | null;
  ocrConfidence?: number | null;
  needsReview?: boolean;
}

export interface CreateStatementInput {
  accountId: number;
  currencyCode: string;
  side: 'ours' | 'theirs';
  /** جلسة المطابقة — تُربط بها في نفس المعاملة (خانة الجهة تُملأ مرة واحدة) */
  sessionId?: number | null;
  openingBalance?: number | null;
  closingBalance?: number | null;
  sourceFile?: {
    originalName: string;
    storedPath: string;
    mimeType: string | null;
    sizeBytes: number;
    sha256: string;
    uploadedBy: number;
  } | null;
  ocrApplied?: boolean;
  createdBy: number;
  lines: StatementLineInput[];
}

export interface StatementWithLines {
  statement: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
}

/** /\d{2,6}/g — نفس استخراج محرك المطابقة بالواجهة (يوحَّد السلوك) */
function extractRefs(...texts: Array<string | null | undefined>): string[] {
  const joined = texts.filter(Boolean).join(' ');
  const matches = joined.match(/\d{2,6}/g) ?? [];
  return [...new Set(matches)];
}

export class StatementsRepository {
  constructor(private readonly pool: Pool) {}

  async createWithLines(input: CreateStatementInput): Promise<number> {
    // sessionId: تُملأ خانة جهة الجلسة داخل نفس المعاملة — 0 صفوف = خانة مشغولة/جلسة مغلقة/حساب مختلف
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      let sourceFileId: string | null = null;
      if (input.sourceFile) {
        const f = await client.query<{ id: string }>(
          `INSERT INTO source_files (original_name, stored_path, mime_type, size_bytes, sha256, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [input.sourceFile.originalName, input.sourceFile.storedPath, input.sourceFile.mimeType, input.sourceFile.sizeBytes, input.sourceFile.sha256, input.sourceFile.uploadedBy],
        );
        sourceFileId = f.rows[0].id;
      }

      // الفترة = أول وآخر تاريخ بنود (تسلسل زمني آمن حتى لو الملف غير مرتب)
      const dates = input.lines.map((l) => l.entryDate).sort();
      const periodStart = dates[0] ?? null;
      const periodEnd = dates[dates.length - 1] ?? null;

      const st = await client.query<{ id: string }>(
        `INSERT INTO statements (account_id, currency_code, side, period_start, period_end,
                                 opening_balance, closing_balance, status, source_file_id, ocr_applied, created_by, committed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'committed', $8, $9, $10, now())
         RETURNING id`,
        [input.accountId, input.currencyCode, input.side, periodStart, periodEnd, input.openingBalance ?? null, input.closingBalance ?? null, sourceFileId, input.ocrApplied ?? false, input.createdBy],
      );
      const statementId = Number(st.rows[0].id);

      const sign = input.side === 'ours' ? 1 : -1; // ours: credit−debit · theirs: debit−credit
      const values: unknown[] = [];
      const tuples = input.lines.map((l, i) => {
        const debit = l.debit ?? null;
        const credit = l.credit ?? null;
        const signed = (Number(credit ?? 0) - Number(debit ?? 0)) * sign;
        const refs = extractRefs(l.description, l.ourRef, l.theirRef);
        const base = i * 12;
        values.push(
          statementId, l.lineNo, l.entryDate, l.description,
          l.ourRef ?? null, l.theirRef ?? null, debit, credit,
          signed, refs, l.ocrConfidence ?? null, l.needsReview ?? false,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}::text[], $${base + 11}, $${base + 12})`;
      });

      await client.query(
        `INSERT INTO statement_lines
           (statement_id, line_no, entry_date, description, our_ref, their_ref, debit, credit, signed_amount, extracted_refs, ocr_confidence, needs_review)
         VALUES ${tuples.join(', ')}`,
        values,
      );

      // ربط الجلسة داخل نفس المعاملة: الخانة تُملأ مرة واحدة + نفس الحساب + جلسة مفتوحة
      if (input.sessionId) {
        const column = input.side === 'ours' ? 'our_statement_id' : 'their_statement_id';
        const attach = await client.query(
          `UPDATE reconciliation_sessions SET ${column} = $2
           WHERE id = $1 AND ${column} IS NULL
             AND account_id = $3 AND status IN ('in_progress','reopened')`,
          [input.sessionId, statementId, input.accountId],
        );
        if (attach.rowCount === 0) {
          throw Object.assign(new Error('SESSION_ATTACH_FAILED'), {
            code: 'SESSION_ATTACH_FAILED',
            messageAr: `تعذر ربط الكشف بالجلسة #${input.sessionId} — خانة جهة مشغولة أو جلسة مغلقة أو حساب مختلف`,
          });
        }
      }

      await client.query('COMMIT');
      return statementId;
    } catch (err) {
      await client.query('ROLLBACK');
      const e = err as { code?: string; constraint?: string };
      // قيد العملة المركب: كشف لعملة ليست عملة الحساب (Q11)
      if (e.code === '23503') throw ERR.CURRENCY_NOT_FOUND();
      throw err;
    } finally {
      client.release();
    }
  }

  async getByIdWithLines(id: number): Promise<StatementWithLines | null> {
    const st = await this.pool.query('SELECT * FROM statements WHERE id = $1', [id]);
    if (!st.rows[0]) return null;
    const lines = await this.pool.query(
      `SELECT id, line_no, entry_date, description, our_ref, their_ref, debit, credit,
              signed_amount, running_balance, extracted_refs, ocr_confidence, needs_review
         FROM statement_lines WHERE statement_id = $1 ORDER BY line_no`,
      [id],
    );
    return { statement: st.rows[0], lines: lines.rows };
  }

  /** هل هذا الحساب/الجهة له كشف معتمد في فترة تتقاطع مع [from,to)؟ (للتحذير من التكرار) */
  async findOverlapping(accountId: number, side: 'ours' | 'theirs', from: string | null, to: string | null): Promise<number | null> {
    if (!from || !to) return null;
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM statements
        WHERE account_id = $1 AND side = $2 AND status = 'committed'
          AND period_start <= $4 AND period_end >= $3
        LIMIT 1`,
      [accountId, side, from, to],
    );
    return rows[0] ? Number(rows[0].id) : null;
  }
}
