import type { Pool } from 'pg';
import type { RefMapEntry } from '../../domain/partner.js';

/** خريطة المراجع لكل حساب — الإضافة اليدوية source=manual (المطابقة الآلية تعتمد auto_* لاحقاً) */
export class RefMapRepository {
  constructor(private readonly pool: Pool) {}

  async listByAccount(accountId: number): Promise<RefMapEntry[]> {
    const { rows } = await this.pool.query<{
      id: string;
      account_id: string;
      our_ref: string;
      their_ref: string;
      source: RefMapEntry['source'];
      created_at: Date;
    }>(
      `SELECT id, account_id, our_ref, their_ref, source, created_at
         FROM ref_map_entries WHERE account_id = $1
        ORDER BY our_ref, their_ref`,
      [accountId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      accountId: Number(r.account_id),
      ourRef: r.our_ref,
      theirRef: r.their_ref,
      source: r.source,
      createdAt: r.created_at,
    }));
  }

  /** ينشئ أو يحدّث الارتباط (فريد بثلاثي account+our+their — الإعادة تُحدّث بدل الخطأ) */
  async upsert(entry: {
    accountId: number;
    ourRef: string;
    theirRef: string;
    confirmedBy: number;
  }): Promise<RefMapEntry> {
    const { rows } = await this.pool.query<{
      id: string;
      account_id: string;
      our_ref: string;
      their_ref: string;
      source: RefMapEntry['source'];
      created_at: Date;
    }>(
      `INSERT INTO ref_map_entries (account_id, our_ref, their_ref, source, confirmed_by)
       VALUES ($1, $2, $3, 'manual', $4)
       ON CONFLICT (account_id, our_ref, their_ref)
       DO UPDATE SET confirmed_by = EXCLUDED.confirmed_by
       RETURNING *`,
      [entry.accountId, entry.ourRef, entry.theirRef, entry.confirmedBy],
    );
    const r = rows[0];
    return {
      id: Number(r.id),
      accountId: Number(r.account_id),
      ourRef: r.our_ref,
      theirRef: r.their_ref,
      source: r.source,
      createdAt: r.created_at,
    };
  }

  async delete(accountId: number, entryId: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM ref_map_entries WHERE account_id = $1 AND id = $2',
      [accountId, entryId],
    );
    return rowCount === 1;
  }
}
