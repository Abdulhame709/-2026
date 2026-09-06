import { mkdir, readdir, readFile, stat, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ERR } from '../domain/errors.js';
import type { Pool } from 'pg';
import type { AuditRepository } from '../infrastructure/repositories/audit.repository.js';

/**
 * النسخ الاحتياطي والاسترجاع (Module 6) — محلي بالكامل (Q16):
 * نسخة = ملف JSON واحد بكل جداول الأعمال (بما فيها مستخدمو وكلماتهم المشفرة —
 * الملف سري للنظام) في backend/storage/backups، والاسترجاع معاملة واحدة
 * (TRUNCATE + إعادة إدراج + ضبط العدّادات) — تعمل دون أي أداة خارجية.
 * جلسات الدخول لا تُسترجع (الجميع يعيد الدخول بعد الاسترجاع — قاعدة أمنية).
 */

const BACKUP_DIR = path.resolve('storage/backups');

/** جداول الأعمال بترتيب الاعتماد (الآباء قبل الأبناء) — auth_sessions مستثناة عمداً */
const TABLES = [
  'currencies',
  'users',
  'partners',
  'accounts',
  'import_templates',
  'source_files',
  'statements',
  'statement_lines',
  'reconciliation_sessions',
  'match_links',
  'match_link_items',
  'reason_codes',
  'notified_adjustments',
  'discrepancies',
  'discrepancy_comments',
  'ref_map_entries',
  'audit_log',
  'settings',
] as const;

interface BackupManifest {
  version: 1;
  /** هوية نظام المطابقة نفسه — مستقل عن أي نظام محاسبي للعملاء (أونكس أو غيره) */
  system: 'supplier-statement-reconciliation';
  createdAt: string;
  createdBy: { id: number; username: string };
  appVersion: string;
  counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
}

export interface BackupInfo {
  name: string;
  createdAt: string;
  sizeBytes: number;
  createdBy: string;
  counts: Record<string, number>;
}

const safeName = (name: string): string => {
  if (!/^backup-[A-Za-z0-9._-]+\.json$/.test(name)) {
    throw ERR.VALIDATION([{ field: 'name', messageAr: 'اسم ملف النسخة غير صالح' }]);
  }
  return name;
};

export class BackupService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditRepository,
  ) {}

  private async ensureDir(): Promise<void> {
    await mkdir(BACKUP_DIR, { recursive: true });
  }

  /** إنشاء نسخة: قراءة الجداول ثم كتابة ملف واحد */
  async create(actor: { id: number; username: string }, ip: string | null): Promise<BackupInfo> {
    await this.ensureDir();
    const tables: Record<string, Record<string, unknown>[]> = {};
    const counts: Record<string, number> = {};
    for (const t of TABLES) {
      const { rows } = await this.pool.query(`SELECT * FROM ${t}`);
      tables[t] = rows;
      counts[t] = rows.length;
    }
    const manifest: BackupManifest = {
      version: 1,
      system: 'supplier-statement-reconciliation',
      createdAt: new Date().toISOString(),
      createdBy: actor,
      appVersion: '0.1.0',
      counts,
      tables,
    };
    const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await writeFile(path.join(BACKUP_DIR, name), JSON.stringify(manifest, null, 1), 'utf8');
    const { size } = await stat(path.join(BACKUP_DIR, name));
    await this.audit.write({
      actorId: actor.id,
      action: 'BACKUP_CREATE',
      entityType: 'backup',
      entityId: name,
      after: { sizeBytes: size, counts: Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)) },
      ip,
    });
    return { name, createdAt: manifest.createdAt, sizeBytes: size, createdBy: actor.username, counts };
  }

  async list(): Promise<BackupInfo[]> {
    await this.ensureDir();
    const names = (await readdir(BACKUP_DIR)).filter((n) => n.endsWith('.json')).sort().reverse();
    const out: BackupInfo[] = [];
    for (const name of names) {
      try {
        const raw = await readFile(path.join(BACKUP_DIR, name), 'utf8');
        const m = JSON.parse(raw) as BackupManifest;
        const { size } = await stat(path.join(BACKUP_DIR, name));
        out.push({
          name,
          createdAt: m.createdAt,
          sizeBytes: size,
          createdBy: m.createdBy?.username ?? '—',
          counts: m.counts ?? {},
        });
      } catch {
        /* ملف تالف — يُتجاهل في القائمة */
      }
    }
    return out;
  }

  /** مسار الملف للتنزيل — أسماء مُدقَّقة فقط (لا اجتياز مسارات) */
  async filePath(name: string): Promise<string> {
    const safe = safeName(name);
    const full = path.join(BACKUP_DIR, safe);
    await stat(full); // يرمي لو غير موجود
    return full;
  }

  /**
   * الاسترجاع: أشد عملية في النظام — معاملة واحدة (مسح + إعادة إدراج + عدّادات).
   * نسخة أثناء الاسترجاع؟ الأفضل أن يُنفَّذ والنظام هادئ — القاعدة تضمن الذرّية.
   */
  async restore(name: string, actor: { id: number; username: string }, ip: string | null): Promise<{ counts: Record<string, number> }> {
    const full = await this.filePath(name);
    const raw = await readFile(full, 'utf8');
    let manifest: BackupManifest;
    try {
      manifest = JSON.parse(raw) as BackupManifest;
    } catch {
      throw ERR.VALIDATION([{ field: 'name', messageAr: 'الملف ليس نسخة صالحة (JSON تالف)' }]);
    }
    if (manifest.version !== 1 || !manifest.tables || typeof manifest.tables !== 'object') {
      throw ERR.VALIDATION([{ field: 'name', messageAr: 'بنية النسخة غير معروفة — إصدار غير مدعوم' }]);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);

      // أعمدة jsonb: تُرمَّز صراحة (السائق يحوّل المصفوفات لصيغة pg-array فترفض jsonb)
      const { rows: jsonbCols } = await client.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE data_type = 'jsonb' AND table_name = ANY($1)`,
        [TABLES as unknown as string[]],
      );
      const jsonbMap = new Map<string, Set<string>>();
      for (const r of jsonbCols) {
        const set = jsonbMap.get(r.table_name) ?? new Set<string>();
        set.add(r.column_name);
        jsonbMap.set(r.table_name, set);
      }

      for (const t of TABLES) {
        const rows = manifest.tables[t] ?? [];
        const jb = jsonbMap.get(t);
        for (const row of rows) {
          const cols = Object.keys(row);
          if (!cols.length) continue;
          const placeholders = cols.map((_, i) => `$${i + 1}`);
          const overriding = cols.includes('id') ? ' OVERRIDING SYSTEM VALUE' : '';
          await client.query(
            `INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(', ')})${overriding}
             VALUES (${placeholders.join(', ')})`,
            cols.map((c) => {
              const v = row[c];
              if (jb?.has(c) && v !== null && typeof v === 'object') return JSON.stringify(v);
              return v;
            }),
          );
        }
      }
      // ضبط عدّادات الهوية بعد الإدراج الصريح — للجداول ذات عمود id فقط (settings مفتاحها نصّي)
      // الأنواع الرقمية فقط — source_files معرفه UUID (لا تسلسل ولا MAX)
      const { rows: idTables } = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.columns
         WHERE column_name = 'id' AND table_name = ANY($1)
           AND data_type IN ('integer','bigint','smallint')`,
        [TABLES as unknown as string[]],
      );
      for (const { table_name } of idTables) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('${table_name}', 'id'),
                  GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table_name}), 1))`,
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23503' || (e as { code?: string }).code === '23505') {
        throw ERR.VALIDATION([{ field: 'name', messageAr: 'النسخة تخل بقواعد السلامة — رفض الاسترجاع (القاعدة كما كانت)' }]);
      }
      throw e;
    } finally {
      client.release();
    }

    const counts = manifest.counts ?? {};
    await this.audit.write({
      actorId: actor.id,
      action: 'BACKUP_RESTORE',
      entityType: 'backup',
      entityId: name,
      after: { counts },
      ip,
    });
    return { counts };
  }

  /** حذف نسخة قديمة (تدبير مساحة القرص المحلي) */
  async deleteBackup(name: string, actor: { id: number; username: string }, ip: string | null): Promise<void> {
    const full = await this.filePath(name);
    await unlink(full);
    await this.audit.write({
      actorId: actor.id,
      action: 'BACKUP_DELETE',
      entityType: 'backup',
      entityId: name,
      after: {},
      ip,
    });
  }
}
