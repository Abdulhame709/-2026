import type { Pool } from 'pg';

/**
 * سجل التدقيق — إلحاق فقط (FR-7.2): لا توجد أي دالة تعديل أو حذف هنا عمداً.
 */
export class AuditRepository {
  constructor(private readonly pool: Pool) {}

  async write(entry: {
    actorId: number | null;
    action: string;
    entityType?: string;
    entityId?: string;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, before, after, ip)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::inet)`,
      [
        entry.actorId,
        entry.action,
        entry.entityType ?? null,
        entry.entityId ?? null,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
        entry.ip ?? null,
      ],
    );
  }

  async list(filters: {
    actorId?: number;
    action?: string;
    search?: string;
    limit: number;
    offset: number;
  }): Promise<{ total: number; items: Array<Record<string, unknown>> }> {
    // بناء WHERE بمعاملات آمنة فقط (لا دمج نصي لقيم المستخدم)
    const sqlParams: unknown[] = [];
    const whereParts: string[] = [];

    if (filters.actorId !== undefined) {
      sqlParams.push(filters.actorId);
      whereParts.push(`a.actor_id = $${sqlParams.length}`);
    }
    if (filters.action) {
      sqlParams.push(filters.action);
      whereParts.push(`a.action = $${sqlParams.length}`);
    }
    if (filters.search) {
      sqlParams.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
      const p = sqlParams.length;
      whereParts.push(
        `(a.entity_type ILIKE $${p - 2} OR a.entity_id ILIKE $${p - 1} OR a.action ILIKE $${p})`,
      );
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const countResult = await this.pool.query(
      `SELECT count(*)::int AS n FROM audit_log a ${whereSql}`,
      sqlParams,
    );

    sqlParams.push(filters.limit, filters.offset);
    const limitIdx = sqlParams.length - 1;
    const offsetIdx = sqlParams.length;

    const items = await this.pool.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.before, a.after,
              host(a.ip) AS ip, a.created_at,
              u.username AS actor_username, u.full_name AS actor_name
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
         ${whereSql}
         ORDER BY a.id DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      sqlParams,
    );
    return { total: countResult.rows[0].n, items: items.rows };
  }
}
