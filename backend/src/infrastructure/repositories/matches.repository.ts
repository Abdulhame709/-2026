import type { Pool } from 'pg';

/**
 * مستودع روابط المطابقة (Module 4) — match_links + match_link_items.
 * الربط = مجموعة بنود متقابلة (بندنا/بندهم) بحصص مخصصة (التوزيع الجزئي).
 * الحالات: suggested (اقتراح المحرك) → confirmed (مؤكد) —
 * الرفض/الفك = is_active=false (يُحفظ السجل: تدقيق + منع إعادة اقتراح pair_key).
 */

export interface GroupLineItem {
  lineId: number;
  /** حصة البند من المجموعة (موقّعة: بندنا سالبة وبندهم موجبة) — NULL = كامل المبلغ */
  allocated: number | null;
}

export interface MatchGroup {
  id: number;
  sessionId: number;
  rule: 'exact_ref' | 'ref_map' | 'description_ref' | 'amount_date' | 'manual';
  status: 'suggested' | 'confirmed';
  isActive: boolean;
  confidence: number | null;
  note: string | null;
  pairKey: string | null;
  createdAt: string;
  items: GroupLineItem[];
}

interface LinkRow {
  id: string | number;
  session_id: string | number;
  rule: MatchGroup['rule'];
  status: MatchGroup['status'];
  is_active: boolean;
  confidence: string | null;
  note: string | null;
  pair_key: string | null;
  created_at: Date;
}

interface ItemRow {
  match_link_id: string | number;
  line_id: string | number;
  allocated: string | null;
}

export interface StatementLineFull {
  id: number;
  statementId: number;
  lineNo: number;
  entryDate: string | null;
  docType: string;
  docNo: string;
  description: string;
  ourRef: string | null;
  theirRef: string | null;
  debit: number | null;
  credit: number | null;
  signed: number;
  extractedRefs: string[];
}

interface LineDbRow {
  id: string | number;
  statement_id: string | number;
  line_no: string | number;
  entry_date: Date | string | null;
  doc_type: string | null;
  doc_no: string | null;
  description: string | null;
  our_ref: string | null;
  their_ref: string | null;
  debit: string | null;
  credit: string | null;
  signed_amount: string;
  extracted_refs: string[] | null;
}

const toLine = (r: LineDbRow): StatementLineFull => ({
  id: Number(r.id),
  statementId: Number(r.statement_id),
  lineNo: Number(r.line_no),
  entryDate: r.entry_date == null ? null : r.entry_date instanceof Date ? r.entry_date.toISOString().slice(0, 10) : String(r.entry_date).slice(0, 10),
  docType: r.doc_type ?? '',
  docNo: r.doc_no ?? '',
  description: r.description ?? '',
  ourRef: r.our_ref,
  theirRef: r.their_ref,
  debit: r.debit == null ? null : Number(r.debit),
  credit: r.credit == null ? null : Number(r.credit),
  signed: Number(r.signed_amount),
  extractedRefs: r.extracted_refs ?? [],
});

export class MatchesRepository {
  constructor(private readonly pool: Pool) {}

  /** بنود الجلسة (جهتي الكشفين) — وقود المحرك وشاشة العمل */
  async sessionLines(sessionId: number): Promise<{ our: StatementLineFull[]; their: StatementLineFull[] }> {
    const { rows } = await this.pool.query<LineDbRow>(
      `SELECT l.* FROM statement_lines l
       JOIN statements s ON s.id = l.statement_id
       WHERE s.id = (SELECT our_statement_id FROM reconciliation_sessions WHERE id = $1)
          OR s.id = (SELECT their_statement_id FROM reconciliation_sessions WHERE id = $1)
       ORDER BY l.line_no`,
      [sessionId],
    );
    const lines = rows.map(toLine);
    const ourStatementId = await this.pool.query('SELECT our_statement_id, their_statement_id FROM reconciliation_sessions WHERE id = $1', [sessionId]);
    const ourId = Number(ourStatementId.rows[0]?.our_statement_id ?? -1);
    return {
      our: lines.filter((l) => l.statementId === ourId),
      their: lines.filter((l) => l.statementId !== ourId),
    };
  }

  /** كل مجموعات الجلسة (النشطة + المرفوضة/المفكوكة للذاكرة والعرض) */
  async groups(sessionId: number): Promise<MatchGroup[]> {
    const links = await this.pool.query<LinkRow>(
      `SELECT id, session_id, rule, status, is_active, confidence, note, pair_key, created_at
       FROM match_links WHERE session_id = $1 ORDER BY id`,
      [sessionId],
    );
    const items = await this.pool.query<ItemRow>(
      `SELECT i.match_link_id, i.line_id, i.allocated
       FROM match_link_items i
       JOIN match_links m ON m.id = i.match_link_id
       WHERE m.session_id = $1 ORDER BY i.line_id`,
      [sessionId],
    );
    const byGroup = new Map<number, GroupLineItem[]>();
    for (const it of items.rows) {
      const gid = Number(it.match_link_id);
      const list = byGroup.get(gid) ?? [];
      list.push({ lineId: Number(it.line_id), allocated: it.allocated == null ? null : Number(it.allocated) });
      byGroup.set(gid, list);
    }
    return links.rows.map((r) => ({
      id: Number(r.id),
      sessionId: Number(r.session_id),
      rule: r.rule,
      status: r.status,
      isActive: r.is_active,
      confidence: r.confidence == null ? null : Number(r.confidence),
      note: r.note,
      pairKey: r.pair_key,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      items: byGroup.get(Number(r.id)) ?? [],
    }));
  }

  /** خريطة المستهلك لكل بند (من المجموعات النشطة) — المتبقي = |الموقّع| − المستهلك */
  async consumedMap(sessionId: number): Promise<Map<number, number>> {
    const { rows } = await this.pool.query<{ line_id: string | number; used: string }>(
      `SELECT i.line_id, SUM(ABS(COALESCE(i.allocated, l.signed_amount))) AS used
       FROM match_link_items i
       JOIN match_links m ON m.id = i.match_link_id AND m.is_active
       JOIN statement_lines l ON l.id = i.line_id
       WHERE m.session_id = $1
       GROUP BY i.line_id`,
      [sessionId],
    );
    const map = new Map<number, number>();
    for (const r of rows) map.set(Number(r.line_id), Number(r.used));
    return map;
  }

  /** بصمات الاقتراحات المرفوضة/المفكوكة — المحرك لا يعيد اقتراحها */
  async rejectedPairKeys(sessionId: number): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ pair_key: string }>(
      `SELECT pair_key FROM match_links
       WHERE session_id = $1 AND NOT is_active AND pair_key IS NOT NULL`,
      [sessionId],
    );
    return new Set(rows.map((r) => r.pair_key));
  }

  /** إعادة توليد نظيفة: حذف الاقتراحات النشطة فقط (المؤكدة والمرفوضة تبقى) */
  async deleteActiveSuggested(sessionId: number): Promise<void> {
    await this.pool.query(
      `DELETE FROM match_links WHERE session_id = $1 AND is_active AND status = 'suggested'`,
      [sessionId],
    );
  }

  /** إدخال مجموعات دفعة واحدة داخل معاملة (يقترحها المحرك أو ينشئها المستخدم يدوياً) */
  async createGroups(
    sessionId: number,
    createdBy: number,
    groups: Array<{ rule: MatchGroup['rule']; confidence: number | null; status: 'suggested' | 'confirmed'; pairKey?: string; note?: string; items: GroupLineItem[] }>,
  ): Promise<number[]> {
    if (groups.length === 0) return [];
    const client = await this.pool.connect();
    const ids: number[] = [];
    try {
      await client.query('BEGIN');
      for (const g of groups) {
        const res = await client.query<{ id: string | number }>(
          `INSERT INTO match_links (session_id, rule, confidence, status, note, pair_key, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [sessionId, g.rule, g.confidence, g.status, g.note ?? null, g.pairKey ?? null, createdBy],
        );
        const gid = Number(res.rows[0].id);
        ids.push(gid);
        for (const item of g.items) {
          await client.query(
            `INSERT INTO match_link_items (match_link_id, line_id, allocated) VALUES ($1, $2, $3)`,
            [gid, item.lineId, item.allocated],
          );
        }
      }
      await client.query('COMMIT');
      return ids;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async setStatus(groupId: number, status: 'suggested' | 'confirmed'): Promise<void> {
    await this.pool.query('UPDATE match_links SET status = $2 WHERE id = $1', [groupId, status]);
  }

  /** الرفض/الفك: إلغاء تفعيل محفوظ (لا حذف) — بنود تتحرر والمحرك لا يعيد اقتراح pair_key */
  async deactivate(groupId: number, userId: number): Promise<void> {
    await this.pool.query(
      `UPDATE match_links SET is_active = false, deactivated_by = $2, deactivated_at = now()
       WHERE id = $1`,
      [groupId, userId],
    );
  }

  /** تحديث/إضافة حصص مجموعة (تعديل التوزيع) */
  async setAllocations(groupId: number, items: GroupLineItem[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM match_link_items WHERE match_link_id = $1', [groupId]);
      for (const item of items) {
        await client.query(
          'INSERT INTO match_link_items (match_link_id, line_id, allocated) VALUES ($1, $2, $3)',
          [groupId, item.lineId, item.allocated],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async getGroupSession(groupId: number): Promise<{ sessionId: number; rule: MatchGroup['rule']; status: MatchGroup['status']; isActive: boolean } | null> {
    const { rows } = await this.pool.query<{ id: string | number; session_id: string | number; rule: MatchGroup['rule']; status: MatchGroup['status']; is_active: boolean }>(
      'SELECT id, session_id, rule, status, is_active FROM match_links WHERE id = $1',
      [groupId],
    );
    if (!rows[0]) return null;
    return { sessionId: Number(rows[0].session_id), rule: rows[0].rule, status: rows[0].status, isActive: rows[0].is_active };
  }
}
