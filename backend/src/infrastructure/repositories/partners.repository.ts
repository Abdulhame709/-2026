import type { Pool } from 'pg';
import { ERR } from '../../domain/errors.js';
import type { Account, MatchRuleName, Partner } from '../../domain/partner.js';

/**
 * مستودع الشركاء وحساباتهم — أكواد الأعمدة int8/numeric تعود نصاً من pg فتُحوَّل Number.
 * توليد الرمز التلقائي: أعلى رقم في أكواد SUP-nn + 1 (هجين — يمكن للشخص تجاوزه بكود يدوي).
 */

interface PartnerRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  partner_type: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: Date;
}

interface AccountRow {
  id: string;
  partner_id: string;
  currency_code: string;
  our_ledger_code: string | null;
  date_window_days: number;
  rule_order: string;
  is_active: boolean;
}

function toPartner(r: PartnerRow): Partner {
  return {
    id: Number(r.id),
    code: r.code,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    partnerType: 'supplier',
    phone: r.phone,
    email: r.email,
    notes: r.notes,
    isActive: r.is_active,
    createdAt: r.created_at,
  };
}

function toAccount(r: AccountRow): Account {
  return {
    id: Number(r.id),
    partnerId: Number(r.partner_id),
    currencyCode: r.currency_code,
    ourLedgerCode: r.our_ledger_code,
    dateWindowDays: Number(r.date_window_days),
    ruleOrder: (r.rule_order ? r.rule_order.split(',') : []) as MatchRuleName[],
    isActive: r.is_active,
  };
}

export interface PartnerInput {
  code?: string;
  nameAr: string;
  nameEn?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export class PartnersRepository {
  constructor(private readonly pool: Pool) {}

  /** الرمز التلقائي التالي: SUP-010 بعد أعلى SUP-009 (يتجاهل الأكواد اليدوية غير الرقمية) */
  async nextCode(): Promise<string> {
    const { rows } = await this.pool.query<{ max: number | null }>(
      `SELECT MAX((regexp_replace(code, '^SUP-0*', '', 'g'))::bigint) AS max
         FROM partners
        WHERE code ~ '^SUP-[0-9]+$'`,
    );
    // pg يعيد MAX(bigint) كنص — "4"+1 في JS دمج نصي = "41"! التحويل إلزامي
    const next = Number(rows[0]?.max ?? 0) + 1;
    return `SUP-${String(next).padStart(3, '0')}`;
  }

  async findByCode(code: string): Promise<Partner | null> {
    const { rows } = await this.pool.query<PartnerRow>(
      'SELECT * FROM partners WHERE lower(code) = lower($1)',
      [code],
    );
    return rows[0] ? toPartner(rows[0]) : null;
  }

  async create(input: PartnerInput): Promise<Partner> {
    const { rows } = await this.pool.query<PartnerRow>(
      `INSERT INTO partners (code, name_ar, name_en, phone, email, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.code, input.nameAr, input.nameEn ?? null, input.phone ?? null, input.email ?? null, input.notes ?? null],
    );
    return toPartner(rows[0]);
  }

  async listAllWithAccounts(): Promise<Array<Partner & { accounts: Account[] }>> {
    const partners = await this.pool.query<PartnerRow>(
      'SELECT * FROM partners ORDER BY code',
    );
    const accounts = await this.pool.query<AccountRow>(
      'SELECT * FROM accounts ORDER BY currency_code',
    );
    const byPartner = new Map<number, Account[]>();
    for (const row of accounts.rows) {
      const acc = toAccount(row);
      (byPartner.get(acc.partnerId) ?? byPartner.set(acc.partnerId, []).get(acc.partnerId)!).push(acc);
    }
    return partners.rows.map((r) => {
      const p = toPartner(r);
      return { ...p, accounts: byPartner.get(p.id) ?? [] };
    });
  }

  async findByIdWithAccounts(id: number): Promise<(Partner & { accounts: Account[] }) | null> {
    const { rows } = await this.pool.query<PartnerRow>('SELECT * FROM partners WHERE id = $1', [id]);
    if (!rows[0]) return null;
    const partner = toPartner(rows[0]);
    const accounts = await this.pool.query<AccountRow>(
      'SELECT * FROM accounts WHERE partner_id = $1 ORDER BY currency_code',
      [id],
    );
    return { ...partner, accounts: accounts.rows.map(toAccount) };
  }

  async update(
    id: number,
    patch: Partial<Omit<PartnerInput, 'code'>> & { isActive?: boolean },
  ): Promise<Partner | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (patch.nameAr !== undefined) add('name_ar', patch.nameAr);
    if (patch.nameEn !== undefined) add('name_en', patch.nameEn);
    if (patch.phone !== undefined) add('phone', patch.phone);
    if (patch.email !== undefined) add('email', patch.email);
    if (patch.notes !== undefined) add('notes', patch.notes);
    if (patch.isActive !== undefined) add('is_active', patch.isActive);
    if (!sets.length) {
      const { rows } = await this.pool.query<PartnerRow>('SELECT * FROM partners WHERE id = $1', [id]);
      return rows[0] ? toPartner(rows[0]) : null;
    }
    params.push(id);
    const { rows } = await this.pool.query<PartnerRow>(
      `UPDATE partners SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return rows[0] ? toPartner(rows[0]) : null;
  }
}

export class AccountsRepository {
  constructor(private readonly pool: Pool) {}

  async listByPartner(partnerId: number): Promise<Account[]> {
    const { rows } = await this.pool.query<AccountRow>(
      'SELECT * FROM accounts WHERE partner_id = $1 ORDER BY currency_code',
      [partnerId],
    );
    return rows.map(toAccount);
  }

  async getById(id: number): Promise<Account | null> {
    const { rows } = await this.pool.query<AccountRow>('SELECT * FROM accounts WHERE id = $1', [id]);
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async create(input: {
    partnerId: number;
    currencyCode: string;
    ourLedgerCode?: string | null;
    dateWindowDays?: number;
  }): Promise<Account> {
    try {
      const { rows } = await this.pool.query<AccountRow>(
        `INSERT INTO accounts (partner_id, currency_code, our_ledger_code, date_window_days)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [input.partnerId, input.currencyCode, input.ourLedgerCode ?? null, input.dateWindowDays ?? 3],
      );
      return toAccount(rows[0]);
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      // تعارض (partner_id, currency_code) = حساب موجود لنفس العملة
      if (e.code === '23505') throw ERR.ACCOUNT_EXISTS();
      if (e.code === '23503') throw ERR.CURRENCY_NOT_FOUND();
      throw err;
    }
  }

  async updateMatchingSettings(
    id: number,
    patch: { dateWindowDays?: number; ruleOrder?: MatchRuleName[] },
  ): Promise<Account | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.dateWindowDays !== undefined) {
      params.push(patch.dateWindowDays);
      sets.push(`date_window_days = $${params.length}`);
    }
    if (patch.ruleOrder !== undefined) {
      params.push(patch.ruleOrder.join(','));
      sets.push(`rule_order = $${params.length}`);
    }
    if (!sets.length) return this.getById(id);
    params.push(id);
    const { rows } = await this.pool.query<AccountRow>(
      `UPDATE accounts SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return rows[0] ? toAccount(rows[0]) : null;
  }
}
