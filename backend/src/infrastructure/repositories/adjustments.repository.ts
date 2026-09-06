import type { Pool } from 'pg';
import { ERR } from '../../domain/errors.js';
import type { NotifiedAdjustment } from '../../domain/partner.js';

/** التسويات المبلَّغة (خصومات/مرتجعات/أخرى) لكل حساب — تُطرح لاحقاً عند المطابقة */
export class AdjustmentsRepository {
  constructor(private readonly pool: Pool) {}

  async listByAccount(accountId: number): Promise<NotifiedAdjustment[]> {
    const { rows } = await this.pool.query<{
      id: string;
      account_id: string;
      adjustment_date: Date;
      adjustment_type: NotifiedAdjustment['adjustmentType'];
      amount: string;
      currency_code: string;
      note: string | null;
      created_at: Date;
    }>(
      `SELECT id, account_id, adjustment_date, adjustment_type, amount, currency_code, note, created_at
         FROM notified_adjustments WHERE account_id = $1
        ORDER BY adjustment_date DESC, id DESC`,
      [accountId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      accountId: Number(r.account_id),
      adjustmentDate: r.adjustment_date.toISOString().slice(0, 10),
      adjustmentType: r.adjustment_type,
      amount: Number(r.amount),
      currencyCode: r.currency_code,
      note: r.note,
      createdAt: r.created_at,
    }));
  }

  async create(entry: {
    accountId: number;
    adjustmentDate: string;
    adjustmentType: NotifiedAdjustment['adjustmentType'];
    amount: number;
    currencyCode: string;
    note?: string | null;
    createdBy: number;
  }): Promise<NotifiedAdjustment> {
    try {
      const { rows } = await this.pool.query<{
        id: string;
        account_id: string;
        adjustment_date: Date;
        adjustment_type: NotifiedAdjustment['adjustmentType'];
        amount: string;
        currency_code: string;
        note: string | null;
        created_at: Date;
      }>(
        `INSERT INTO notified_adjustments (account_id, adjustment_date, adjustment_type, amount, currency_code, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [entry.accountId, entry.adjustmentDate, entry.adjustmentType, entry.amount, entry.currencyCode, entry.note ?? null, entry.createdBy],
      );
      const r = rows[0];
      return {
        id: Number(r.id),
        accountId: Number(r.account_id),
        adjustmentDate: r.adjustment_date.toISOString().slice(0, 10),
        adjustmentType: r.adjustment_type,
        amount: Number(r.amount),
        currencyCode: r.currency_code,
        note: r.note,
        createdAt: r.created_at,
      };
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === '23503') throw ERR.CURRENCY_NOT_FOUND();
      throw err;
    }
  }
}
