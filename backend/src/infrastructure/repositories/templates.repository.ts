import type { Pool } from 'pg';
import type { ImportTemplate } from '../../domain/partner.js';

/**
 * قوالب الاستيراد — قالب «كشوفنا» (ONYX PRO) مشترك بحساب NULL،
 * وكل مورد له قوالب «كشوفهم» الخاصة بترتيب أعمدته.
 */
export class TemplatesRepository {
  constructor(private readonly pool: Pool) {}

  /** قوالب الحساب = قوالب كشوفهم الخاصة + قالب كشوفنا المشترك */
  async listForAccount(accountId: number): Promise<ImportTemplate[]> {
    const { rows } = await this.pool.query<TemplateRow>(
      `SELECT * FROM import_templates
        WHERE (account_id = $1 AND template_kind = 'theirs')
           OR (account_id IS NULL AND template_kind = 'ours')
        ORDER BY template_kind, is_default DESC, name`,
      [accountId],
    );
    return rows.map(toTemplate);
  }

  async getById(id: number): Promise<ImportTemplate | null> {
    const { rows } = await this.pool.query<TemplateRow>(
      'SELECT * FROM import_templates WHERE id = $1',
      [id],
    );
    return rows[0] ? toTemplate(rows[0]) : null;
  }

  async listOurs(): Promise<ImportTemplate[]> {
    const { rows } = await this.pool.query<TemplateRow>(
      `SELECT * FROM import_templates
        WHERE account_id IS NULL AND template_kind = 'ours'
        ORDER BY is_default DESC, name`,
    );
    return rows.map(toTemplate);
  }

  async create(t: {
    accountId: number | null;
    templateKind: ImportTemplate['templateKind'];
    name: string;
    headerRows: number;
    columnsMapping: Record<string, string>;
    dateFormats: string[];
    decimalSep: string;
    thousandSep: string;
    isDefault: boolean;
    createdBy: number;
  }): Promise<ImportTemplate> {
    // الافتراضي وحيد لكل (حساب، نوع) — الأساسي الجديد يُزيح القديم
    if (t.isDefault) {
      await this.pool.query(
        'UPDATE import_templates SET is_default = false WHERE COALESCE(account_id, 0) = COALESCE($1, 0) AND template_kind = $2',
        [t.accountId, t.templateKind],
      );
    }
    const { rows } = await this.pool.query<TemplateRow>(
      `INSERT INTO import_templates
         (account_id, template_kind, name, header_rows, columns_mapping, date_formats, decimal_sep, thousand_sep, is_default, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)
       RETURNING *`,
      [t.accountId, t.templateKind, t.name, t.headerRows, JSON.stringify(t.columnsMapping), JSON.stringify(t.dateFormats), t.decimalSep, t.thousandSep, t.isDefault, t.createdBy],
    );
    return toTemplate(rows[0]);
  }
}

interface TemplateRow {
  id: string;
  account_id: string | null;
  template_kind: ImportTemplate['templateKind'];
  name: string;
  header_rows: number;
  columns_mapping: unknown;
  date_formats: unknown;
  decimal_sep: string;
  thousand_sep: string;
  is_default: boolean;
}

function toTemplate(r: TemplateRow): ImportTemplate {
  return {
    id: Number(r.id),
    accountId: r.account_id === null ? null : Number(r.account_id),
    templateKind: r.template_kind,
    name: r.name,
    headerRows: Number(r.header_rows),
    columnsMapping: (r.columns_mapping ?? {}) as Record<string, string>,
    dateFormats: (r.date_formats ?? []) as string[],
    decimalSep: r.decimal_sep,
    thousandSep: r.thousand_sep,
    isDefault: r.is_default,
  };
}
