import { mkdir, readdir, readFile, stat, writeFile, unlink, lstat, open } from 'node:fs/promises';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import path from 'node:path';
import { AppError, ERR } from '../domain/errors.js';
import { backupKey, decryptBackup, encryptBackup } from './backup-crypto.js';
import type { Pool } from 'pg';
import type { AuditRepository } from '../infrastructure/repositories/audit.repository.js';

/**
 * النسخ الاحتياطي والاسترجاع (Module 6) — محلي بالكامل (Q16):
 * نسخة = ملف مشفر واحد بكل جداول الأعمال (بما فيها مستخدمو وتجزئات كلماتهم —
 * الملف سري للنظام) في backend/storage/backups، والاسترجاع معاملة واحدة
 * (TRUNCATE + إعادة إدراج + ضبط العدّادات) — تعمل دون أي أداة خارجية.
 * جلسات الدخول لا تُسترجع (الجميع يعيد الدخول بعد الاسترجاع — قاعدة أمنية).
 */

const BACKUP_DIR = path.resolve('storage/backups');
const UPLOAD_DIR = path.resolve('storage/uploads');
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
const MAX_UPLOAD_FILES = 2_000;
const FILE_NAME = /^[A-Za-z0-9._-]{1,255}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

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
  version: 1 | 2;
  /** هوية نظام المطابقة نفسه — مستقل عن أي نظام محاسبي للعملاء (أونكس أو غيره) */
  system: 'supplier-statement-reconciliation';
  createdAt: string;
  createdBy: { id: number; username: string };
  appVersion: string;
  counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
  files?: Array<{ name: string; sha256: string; sizeBytes: number; data: string }>;
}

const fileDigest = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

function verifiedFiles(manifest: BackupManifest): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  if (manifest.version === 1) return files;
  if (!Array.isArray(manifest.files) || manifest.files.length > MAX_UPLOAD_FILES) {
    throw ERR.VALIDATION([{ field: 'name', messageAr: 'قائمة ملفات النسخة غير صالحة أو تجاوزت الحد' }]);
  }
  let total = 0;
  for (const file of manifest.files) {
    if (!file || typeof file.name !== 'string' || !FILE_NAME.test(file.name) || file.name === '.' || file.name === '..' ||
        files.has(file.name) || typeof file.data !== 'string' || !BASE64.test(file.data) ||
        typeof file.sha256 !== 'string' || !SHA256.test(file.sha256) ||
        !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || file.sizeBytes > MAX_UPLOAD_BYTES) {
      throw ERR.VALIDATION([{ field: 'name', messageAr: 'بيانات أحد ملفات النسخة غير صالحة' }]);
    }
    total += file.sizeBytes;
    if (total > MAX_UPLOAD_BYTES || file.data.length > Math.ceil(file.sizeBytes / 3) * 4 + 4) {
      throw ERR.VALIDATION([{ field: 'name', messageAr: 'حجم الملفات في النسخة تجاوز الحد المسموح' }]);
    }
    const data = Buffer.from(file.data, 'base64');
    if (data.length !== file.sizeBytes || fileDigest(data) !== file.sha256) {
      throw ERR.VALIDATION([{ field: 'name', messageAr: 'فشل التحقق من بصمة أحد الملفات المرفوعة في النسخة' }]);
    }
    files.set(file.name, data);
  }
  return files;
}

function referencedLogo(manifest: BackupManifest): string | null {
  const company = manifest.tables.settings.find((row) => row.key === 'company')?.value;
  if (!company || typeof company !== 'object' || Array.isArray(company)) return null;
  const logo = (company as { logoFileName?: unknown }).logoFileName;
  return typeof logo === 'string' ? logo : null;
}

function verifyReferences(manifest: BackupManifest, files: Map<string, Buffer>): void {
  for (const row of manifest.tables.source_files) {
    const storedPath = row.stored_path;
    const sha256 = row.sha256;
    const file = typeof storedPath === 'string' ? files.get(path.basename(storedPath)) : undefined;
    if (!file || typeof sha256 !== 'string' || !SHA256.test(sha256.toLowerCase()) ||
        fileDigest(file) !== sha256.toLowerCase()) {
      throw ERR.VALIDATION([{ field: 'name', messageAr: 'ملف كشف مفقود أو بصمته مختلفة عن سجل القاعدة' }]);
    }
  }
  const logo = referencedLogo(manifest);
  if (logo && (!/^logo-\d+\.(?:png|jpg)$/.test(logo) || !files.has(logo))) {
    throw ERR.VALIDATION([{ field: 'name', messageAr: 'شعار الشركة المشار إليه في القاعدة غير موجود في النسخة' }]);
  }
}

function parseManifest(raw: string): BackupManifest {
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(raw) as BackupManifest;
  } catch {
    throw ERR.VALIDATION([{ field: 'name', messageAr: 'الملف ليس نسخة صالحة (JSON تالف)' }]);
  }
  if (!manifest || ![1, 2].includes(manifest.version) || manifest.system !== 'supplier-statement-reconciliation' ||
      !manifest.tables || Array.isArray(manifest.tables) || typeof manifest.tables !== 'object' ||
      !manifest.counts || Array.isArray(manifest.counts) || typeof manifest.counts !== 'object' ||
      Object.keys(manifest.tables).length !== TABLES.length ||
      TABLES.some((table) => !Array.isArray(manifest.tables[table]) ||
        manifest.counts[table] !== manifest.tables[table].length ||
        manifest.tables[table].some((row) => row === null || Array.isArray(row) || typeof row !== 'object' ||
          Object.keys(row).some((column) => !/^[a-z_][a-z0-9_]*$/.test(column))))) {
    throw ERR.VALIDATION([{ field: 'name', messageAr: 'بنية النسخة غير معروفة — إصدار غير مدعوم' }]);
  }
  if (manifest.version === 2) verifyReferences(manifest, verifiedFiles(manifest));
  if (manifest.version === 1 && manifest.files !== undefined) {
    throw ERR.VALIDATION([{ field: 'name', messageAr: 'صيغة النسخة القديمة لا تشمل ملفات مرفوعة' }]);
  }
  return manifest;
}

export interface BackupInfo {
  name: string;
  createdAt: string;
  sizeBytes: number;
  createdBy: string;
  counts: Record<string, number>;
  encrypted: boolean;
  readable: boolean;
  includesUploads: boolean;
  fileCount: number;
}

const safeName = (name: string): string => {
  if (!/^backup-[A-Za-z0-9._-]+\.(?:json|enc)$/.test(name)) {
    throw ERR.VALIDATION([{ field: 'name', messageAr: 'اسم ملف النسخة غير صالح' }]);
  }
  return name;
};

export class BackupService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditRepository,
    private readonly backupDir = BACKUP_DIR,
    private readonly uploadDir = UPLOAD_DIR,
  ) {}

  private async ensureDir(): Promise<void> {
    await mkdir(this.backupDir, { recursive: true, mode: 0o700 });
  }

  private async readUploads(): Promise<Array<{ name: string; sha256: string; sizeBytes: number; data: string }>> {
    await mkdir(this.uploadDir, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.uploadDir, { withFileTypes: true });
    if (entries.length > MAX_UPLOAD_FILES) {
      throw ERR.VALIDATION([{ field: 'backup', messageAr: 'عدد الملفات المرفوعة كبير جداً للنسخ الحالي' }]);
    }
    const files = [];
    let total = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !FILE_NAME.test(entry.name) || entry.name === '.' || entry.name === '..') {
        throw ERR.VALIDATION([{ field: 'backup', messageAr: 'مجلد الملفات المرفوعة يحتوي اسماً أو نوع ملف غير مدعوم' }]);
      }
      const filePath = path.join(this.uploadDir, entry.name);
      const info = await lstat(filePath);
      if (!info.isFile() || total + info.size > MAX_UPLOAD_BYTES) {
        throw ERR.VALIDATION([{ field: 'backup', messageAr: 'حجم الملفات المرفوعة يتجاوز 256 ميغابايت أو تغيّر نوع أحدها — لا تُنشأ نسخة ناقصة' }]);
      }
      const data = await readFile(filePath);
      total += data.length;
      if (total > MAX_UPLOAD_BYTES) {
        throw ERR.VALIDATION([{ field: 'backup', messageAr: 'حجم الملفات المرفوعة يتجاوز 256 ميغابايت — لا تُنشأ نسخة ناقصة' }]);
      }
      files.push({ name: entry.name, sha256: fileDigest(data), sizeBytes: data.length, data: data.toString('base64') });
    }
    return files;
  }

  private async verifyLegacyUploads(manifest: BackupManifest): Promise<void> {
    for (const row of manifest.tables.source_files) {
      const storedPath = row.stored_path;
      const sha256 = row.sha256;
      if (typeof storedPath !== 'string' || typeof sha256 !== 'string' ||
          path.resolve(storedPath) !== path.join(this.uploadDir, path.basename(storedPath))) {
        throw ERR.VALIDATION([{ field: 'name', messageAr: 'النسخة القديمة تشير إلى ملف خارج مجلد الرفع الحالي' }]);
      }
      let data: Buffer;
      try {
        if (!(await lstat(storedPath)).isFile()) throw new Error('not a regular file');
        data = await readFile(storedPath);
      } catch {
        throw ERR.VALIDATION([{ field: 'name', messageAr: 'النسخة القديمة لا تشمل الملفات وبعض أصولها غير موجودة' }]);
      }
      if (fileDigest(data) !== sha256.toLowerCase()) {
        throw ERR.VALIDATION([{ field: 'name', messageAr: 'بصمة ملف في النسخة القديمة لا تطابق الملف المحلي' }]);
      }
    }
    const logo = referencedLogo(manifest);
    if (logo) {
      if (!/^logo-\d+\.(?:png|jpg)$/.test(logo)) {
        throw ERR.VALIDATION([{ field: 'name', messageAr: 'اسم شعار النسخة القديمة غير صالح' }]);
      }
      try {
        if (!(await lstat(path.join(this.uploadDir, logo))).isFile()) throw new Error('not a regular file');
      } catch {
        throw ERR.VALIDATION([{ field: 'name', messageAr: 'شعار النسخة القديمة غير موجود على الجهاز' }]);
      }
    }
  }

  private async stageUploads(manifest: BackupManifest): Promise<string[]> {
    const files = verifiedFiles(manifest);
    verifyReferences(manifest, files);
    await mkdir(this.uploadDir, { recursive: true, mode: 0o700 });
    const logo = referencedLogo(manifest);
    const destinations = new Map<string, string>();
    const staged: string[] = [];
    try {
      for (const [name, data] of files) {
        const newName = name === logo
          ? `logo-${Date.now()}${randomInt(1_000_000_000)}${path.extname(name)}`
          : `restored-${randomUUID()}-${name.slice(-100)}`;
        const destination = path.join(this.uploadDir, newName);
        const handle = await open(destination, 'wx', 0o600);
        staged.push(destination);
        try {
          await handle.writeFile(data);
        } finally {
          await handle.close();
        }
        destinations.set(name, destination);
      }
      for (const row of manifest.tables.source_files) {
        row.stored_path = destinations.get(path.basename(String(row.stored_path)))!;
      }
      if (logo) {
        const company = manifest.tables.settings.find((row) => row.key === 'company')!;
        company.value = { ...(company.value as Record<string, unknown>), logoFileName: path.basename(destinations.get(logo)!) };
      }
      return staged;
    } catch (error) {
      await Promise.all(staged.map((file) => unlink(file).catch(() => undefined)));
      throw error;
    }
  }

  /** إنشاء نسخة: قراءة الجداول ثم كتابة ملف واحد */
  async create(actor: { id: number; username: string }, ip: string | null): Promise<BackupInfo> {
    const key = backupKey();
    await this.ensureDir();
    const tables: Record<string, Record<string, unknown>[]> = {};
    const counts: Record<string, number> = {};
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      for (const table of TABLES) {
        const { rows } = await client.query(`SELECT * FROM ${table}`);
        tables[table] = rows;
        counts[table] = rows.length;
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const manifest: BackupManifest = {
      version: 2,
      system: 'supplier-statement-reconciliation',
      createdAt: new Date().toISOString(),
      createdBy: actor,
      appVersion: '0.1.0',
      counts,
      tables,
      files: await this.readUploads(),
    };
    verifyReferences(manifest, verifiedFiles(manifest));
    const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.enc`;
    const data = encryptBackup(Buffer.from(JSON.stringify(manifest)), name, key);
    await writeFile(path.join(this.backupDir, name), data, { flag: 'wx', mode: 0o600 });
    const { size } = await stat(path.join(this.backupDir, name));
    await this.audit.write({
      actorId: actor.id,
      action: 'BACKUP_CREATE',
      entityType: 'backup',
      entityId: name,
      after: { sizeBytes: size, fileCount: manifest.files!.length, counts: Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)) },
      ip,
    });
    return { name, createdAt: manifest.createdAt, sizeBytes: size, createdBy: actor.username, counts, encrypted: true, readable: true, includesUploads: true, fileCount: manifest.files!.length };
  }

  async list(): Promise<BackupInfo[]> {
    await this.ensureDir();
    const names = (await readdir(this.backupDir)).filter((name) => /^backup-[A-Za-z0-9._-]+\.(?:json|enc)$/.test(name)).sort().reverse();
    const key = names.some((name) => name.endsWith('.enc')) ? backupKey() : null;
    const out: BackupInfo[] = [];
    for (const name of names) {
      const encrypted = name.endsWith('.enc');
      const { size, mtime } = await stat(path.join(this.backupDir, name));
      try {
        const data = await readFile(path.join(this.backupDir, name));
        const raw = encrypted ? decryptBackup(data, name, key!).toString('utf8') : data.toString('utf8');
        const m = parseManifest(raw);
        out.push({
          name,
          createdAt: m.createdAt,
          sizeBytes: size,
          createdBy: m.createdBy?.username ?? '—',
          counts: m.counts ?? {},
          encrypted,
          readable: true,
          includesUploads: m.version === 2,
          fileCount: m.files?.length ?? 0,
        });
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== 'VALIDATION_FAILED') throw error;
        if (encrypted) {
          out.push({ name, createdAt: mtime.toISOString(), sizeBytes: size, createdBy: '—', counts: {}, encrypted, readable: false, includesUploads: false, fileCount: 0 });
        }
      }
    }
    return out;
  }

  /** مسار الملف للتنزيل — أسماء مُدقَّقة فقط (لا اجتياز مسارات) */
  async filePath(name: string, allowLegacy = false): Promise<string> {
    const safe = safeName(name);
    if (!allowLegacy && safe.endsWith('.json')) {
      throw ERR.VALIDATION([{ field: 'name', messageAr: 'هذه نسخة قديمة غير مشفرة — شفّرها قبل التنزيل أو الاستعادة' }]);
    }
    const full = path.join(this.backupDir, safe);
    await stat(full); // يرمي لو غير موجود
    return full;
  }

  async encryptLegacy(name: string, actor: { id: number; username: string }, ip: string | null): Promise<BackupInfo> {
    if (!name.endsWith('.json')) throw ERR.VALIDATION([{ field: 'name', messageAr: 'اختر نسخة JSON قديمة لتشفيرها' }]);
    const key = backupKey();
    const original = await this.filePath(name, true);
    const raw = await readFile(original);
    const manifest = parseManifest(raw.toString('utf8'));
    const encryptedName = `${name.slice(0, -5)}.enc`;
    const data = encryptBackup(raw, encryptedName, key);
    if (!decryptBackup(data, encryptedName, key).equals(raw)) throw new Error('فشل التحقق من النسخة المشفرة');
    await writeFile(path.join(this.backupDir, encryptedName), data, { flag: 'wx', mode: 0o600 });
    await this.audit.write({ actorId: actor.id, action: 'BACKUP_ENCRYPT', entityType: 'backup', entityId: encryptedName, ip });
    return {
      name: encryptedName,
      createdAt: manifest.createdAt,
      sizeBytes: data.length,
      createdBy: manifest.createdBy?.username ?? '—',
      counts: manifest.counts ?? {},
      encrypted: true,
      readable: true,
      includesUploads: manifest.version === 2,
      fileCount: manifest.files?.length ?? 0,
    };
  }

  /**
   * الاسترجاع: أشد عملية في النظام — معاملة واحدة (مسح + إعادة إدراج + عدّادات).
   * نسخة أثناء الاسترجاع؟ الأفضل أن يُنفَّذ والنظام هادئ — القاعدة تضمن الذرّية.
   */
  async restore(name: string, actor: { id: number; username: string }, ip: string | null): Promise<{ counts: Record<string, number> }> {
    if (!name.endsWith('.enc')) {
      throw ERR.VALIDATION([{ field: 'name', messageAr: 'النسخ القديمة غير المشفرة لا تُستعاد مباشرة — شفّرها أولاً من شاشة النسخ' }]);
    }
    const full = await this.filePath(name);
    const raw = decryptBackup(await readFile(full), name, backupKey()).toString('utf8');
    const manifest = parseManifest(raw);

    if (manifest.version === 1) await this.verifyLegacyUploads(manifest);
    const staged = manifest.version === 2 ? await this.stageUploads(manifest) : [];

    const client = await this.pool.connect().catch(async (error: unknown) => {
      await Promise.all(staged.map((file) => unlink(file).catch(() => undefined)));
      throw error;
    });
    let commitAttempted = false;
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
      const { rows: restoredActors } = await client.query<{ id: number }>(
        'SELECT id FROM users WHERE id = $1 AND username = $2', [actor.id, actor.username],
      );
      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, after, ip)
         VALUES ($1, 'BACKUP_RESTORE', 'backup', $2, $3::jsonb, $4::inet)`,
        [restoredActors.length ? actor.id : null, name, JSON.stringify({ counts: manifest.counts ?? {}, filesRestored: staged.length, requestedBy: actor.username }), ip],
      );
      commitAttempted = true;
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (!commitAttempted) await Promise.all(staged.map((file) => unlink(file).catch(() => undefined)));
      if ((e as { code?: string }).code === '23503' || (e as { code?: string }).code === '23505') {
        throw ERR.VALIDATION([{ field: 'name', messageAr: 'النسخة تخل بقواعد السلامة — رفض الاسترجاع (القاعدة كما كانت)' }]);
      }
      throw e;
    } finally {
      client.release();
    }

    const counts = manifest.counts ?? {};
    return { counts };
  }

  /** حذف نسخة قديمة (تدبير مساحة القرص المحلي) */
  async deleteBackup(name: string, actor: { id: number; username: string }, ip: string | null): Promise<void> {
    const full = await this.filePath(name, true);
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
