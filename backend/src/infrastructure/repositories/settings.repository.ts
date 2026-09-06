import type { Pool } from 'pg';

/**
 * مستودع الإعدادات (Module 6): بيانات الشركة (settings key='company')
 * + إدارة كاملة لرموز الأسباب (إضافة/تعطيل/ترتيب — تظهر في درج الفروق وتقارير الموردين).
 */

export interface CompanySettings {
  nameAr: string;
  nameEn: string;
  address: string;
  phone: string;
  email: string;
  reportHeaderNote: string;
  logoFileName: string | null;
  currencyOrder: string[];
}

export const DEFAULT_COMPANY: CompanySettings = {
  nameAr: '',
  nameEn: '',
  address: '',
  phone: '',
  email: '',
  reportHeaderNote: '',
  logoFileName: null,
  currencyOrder: ['YER', 'USD', 'SAR'],
};

export interface ReasonCodeDetailed {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
  sortOrder: number;
}

export class SettingsRepository {
  constructor(private readonly pool: Pool) {}

  async getCompany(): Promise<CompanySettings> {
    const { rows } = await this.pool.query<{ value: CompanySettings }>(
      `SELECT value FROM settings WHERE key = 'company'`,
    );
    if (!rows[0]) return { ...DEFAULT_COMPANY };
    return { ...DEFAULT_COMPANY, ...rows[0].value };
  }

  async saveCompany(value: CompanySettings, updatedBy: number): Promise<CompanySettings> {
    await this.pool.query(
      `INSERT INTO settings (key, value, updated_by, updated_at)
       VALUES ('company', $1::jsonb, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_by = $2, updated_at = now()`,
      [JSON.stringify(value), updatedBy],
    );
    return value;
  }

  async listReasonCodes(): Promise<ReasonCodeDetailed[]> {
    const { rows } = await this.pool.query<{
      id: string | number;
      code: string;
      name_ar: string;
      name_en: string;
      is_active: boolean;
      sort_order: string | number;
    }>(
      `SELECT id, code, name_ar, name_en, is_active, sort_order
       FROM reason_codes ORDER BY sort_order, id`,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      code: r.code,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      isActive: r.is_active,
      sortOrder: Number(r.sort_order),
    }));
  }

  /** إضافة سبب جديد — الرمز يُشتق آلياً من الاسم الإنجليزي إن لم يُرَد */
  async addReasonCode(input: { nameAr: string; nameEn: string }): Promise<ReasonCodeDetailed> {
    let code =
      input.nameEn
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'CUSTOM_REASON';
    const taken = await this.pool.query('SELECT code FROM reason_codes WHERE code = $1', [code]);
    if (taken.rows[0]) code = `${code}_${Date.now().toString(36).toUpperCase().slice(-4)}`;
    const { rows } = await this.pool.query<{ max: string | null }>(
      'SELECT MAX(sort_order) AS max FROM reason_codes',
    );
    const sortOrder = Number(rows[0].max ?? 0) + 1;
    const res = await this.pool.query<{ id: string | number }>(
      `INSERT INTO reason_codes (code, name_ar, name_en, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [code, input.nameAr, input.nameEn, sortOrder],
    );
    return {
      id: Number(res.rows[0].id),
      code,
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      isActive: true,
      sortOrder,
    };
  }

  async updateReasonCode(
    id: number,
    patch: { isActive?: boolean; nameAr?: string; nameEn?: string },
  ): Promise<boolean> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.isActive !== undefined) {
      params.push(patch.isActive);
      sets.push(`is_active = $${params.length}`);
    }
    if (patch.nameAr !== undefined) {
      params.push(patch.nameAr);
      sets.push(`name_ar = $${params.length}`);
    }
    if (patch.nameEn !== undefined) {
      params.push(patch.nameEn);
      sets.push(`name_en = $${params.length}`);
    }
    if (!sets.length) return true;
    params.push(id);
    const res = await this.pool.query(
      `UPDATE reason_codes SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params,
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** إعادة الترتيب: مصفوفة المعرفات بالترتيب الجديد */
  async reorderReasonCodes(ids: number[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < ids.length; i++) {
        await client.query('UPDATE reason_codes SET sort_order = $1 WHERE id = $2', [i + 1, ids[i]]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
