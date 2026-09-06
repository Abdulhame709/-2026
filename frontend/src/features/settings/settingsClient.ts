import { api, fileUrl, uploadFile} from '@/shared/api/client';
import type { UserRoleName } from '@/features/auth/roles';

/**
 * عميل الإعدادات والإدارة (Module 6) — بيانات الشركة، أسباب الفروق، النسخ الاحتياطي.
 * (المستخدمون وسجل التدقيق حقيقيان من الوحدة 1 داخل تبويبيهما مباشرة.)
 */

/** مستخدم كما يعيده الخادم (GET /api/v1/users) */
export interface ManagedUser {
  id: number;
  username: string;
  fullName: string;
  role: UserRoleName;
  isActive: boolean;
  mustChangePassword: boolean;
}

/** سبب فرق كما يعيده الخادم (GET /api/v1/reason-codes) */
export interface ReasonCodeRow {
  id: number;
  code: string;
  labelAr: string;
  labelEn: string;
  isActive: boolean;
}

/** رابط عرض الشعار بنفس قناة الجلسة — ل<img> في الترويسة والتقرير */
export const companyLogoUrl = (logoFileName: string | null): string | null =>
  logoFileName ? fileUrl('/api/v1/settings/company/logo') : null;

export interface CompanySettings {
  nameAr: string;
  nameEn: string;
  address: string;
  phone: string;
  email: string;
  reportHeaderNote: string;
  logoFileName: string | null;
  currencyOrder: ('YER' | 'USD' | 'SAR')[];
  /** شكل الأرقام في التقارير — تفضيل واجهة (الخادم يعتمد اللاتيني حالياً) */
  numerals?: 'latin' | 'arabic_indic';
}

/** رفع الشعار محلياً (أدمن) — PNG/JPG/SVG حتى 300KB */
export const uploadCompanyLogo = (file: File) =>
  uploadFile<{ company: CompanySettings }>('/api/v1/settings/company/logo', file, {});

/** إزالة الشعار (أدمن) */
export const removeCompanyLogo = () =>
  api.delete<{ company: CompanySettings }>('/api/v1/settings/company/logo');

export interface BackupInfo {
  name: string;
  createdAt: string;
  sizeBytes: number;
  createdBy: string;
  counts: Record<string, number>;
}

/** سجل تدقيق كما تعرضه شاشة السجل (مُحوَّل من جواب الخادم) */
export interface AuditEntry {
  id: string;
  actorName: string;
  timeLabel: string;
  action: string;
  entity: string;
  detail: string;
  ip: string;
}

export const ROLE_DESCRIPTIONS: Record<UserRoleName, string> = {
  admin: 'كل الصلاحيات: المستخدمون، النسخ الاحتياطي، سجل التدقيق، وكل ما يفعله المحاسب',
  reconciler: 'يدير الأطراف والجلسات والمطابقة والفروق والتقارير — لا يلمس المستخدمين ولا النسخ',
  viewer: 'اطمئنان وقراءة فقط: الجلسات والتقارير والأرشيف — بلا أي تعديل',
};

/** تسميات عربية لأفعال التدقيق — شفافية السجل */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOGIN: 'تسجيل دخول',
  LOGIN_FAILED: 'فشل دخول',
  LOGIN_BLOCKED_DISABLED: 'دخول محظور (معطل)',
  LOGOUT: 'تسجيل خروج',
  PASSWORD_CHANGE: 'تغيير كلمة مرور',
  PASSWORD_CHANGED: 'تغيير كلمة مرور',
  PASSWORD_CHANGED_BY_ADMIN: 'تغيير كلمة مرور مستخدم',
  USER_CREATE: 'إنشاء مستخدم',
  USER_UPDATE: 'تعديل مستخدم',
  USER_DEACTIVATE: 'تعطيل مستخدم',
  USER_ACTIVATE: 'تفعيل مستخدم',
  USER_FORCE_PASSWORD_CHANGE: 'إجبار تغيير مرور',
  PARTNER_CREATE: 'إنشاء مورد',
  PARTNER_UPDATE: 'تعديل مورد',
  ACCOUNT_CREATE: 'إنشاء حساب',
  ACCOUNT_UPDATE: 'تعديل حساب',
  MATCHING_SETTINGS_UPDATE: 'تحديث إعدادات المطابقة',
  REFMAP_SAVE: 'حفظ خريطة مراجع',
  REFMAP_DELETE: 'حذف مرجع',
  ADJUSTMENT_ADD: 'تسوية مُبلَّغة',
  TEMPLATE_SAVE: 'حفظ قالب استيراد',
  STATEMENT_COMMIT: 'اعتماد كشف',
  STATEMENT_MANUAL: 'إدخال كشف يدوي',
  SESSION_CREATE: 'إنشاء جلسة',
  SESSION_CLOSE: 'إغلاق جلسة',
  SESSION_REOPEN: 'إعادة فتح جلسة',
  MATCH_SUGGEST: 'اقتراحات المطابقة',
  MATCH_CONFIRM: 'قبول اقتراح',
  MATCH_REJECT: 'رفض اقتراح',
  MATCH_UNLINK: 'فك ربط',
  MATCH_MANUAL: 'ربط يدوي',
  MATCH_ADJUST: 'تعديل حصص',
  DISC_UPDATE: 'تحديث فرق',
  DISCREPANCY_UPDATE: 'تحديث فرق',
  DISCREPANCY_CARRY: 'ترحيل فرق',
  REPORT_EXPORT: 'تصدير تقرير',
  REASON_CODE_CREATE: 'إضافة سبب',
  REASON_CODE_UPDATE: 'تعديل سبب',
  REASON_CODE_REORDER: 'ترتيب الأسباب',
  COMPANY_SETTINGS_UPDATE: 'تحديث بيانات الشركة',
  SETTINGS_UPDATE: 'تعديل إعدادات',
  BACKUP_RUN: 'تشغيل نسخة احتياطية',
  BACKUP_CREATE: 'إنشاء نسخة احتياطية',
  BACKUP_RESTORE: 'استرجاع نسخة',
  BACKUP_DELETE: 'حذف نسخة',
};

// ===== الشركة =====

export const getCompany = () =>
  api.get<{ company: CompanySettings }>('/api/v1/settings/company').then((r) => r.company);

export const saveCompany = (company: CompanySettings) =>
  api.put<{ company: CompanySettings }>('/api/v1/settings/company', company).then((r) => r.company);

// ===== أسباب الفروق =====

export const listReasonCodes = () =>
  api
    .get<{
      reasonCodes: Array<{ id: number; code: string; nameAr: string; nameEn: string; isActive: boolean }>;
    }>('/api/v1/reason-codes')
    .then((r) =>
      r.reasonCodes.map((x) => ({
        id: x.id,
        code: x.code,
        labelAr: x.nameAr,
        labelEn: x.nameEn,
        isActive: x.isActive,
      })),
    );

export const addReasonCode = (nameAr: string, nameEn: string) =>
  api.post<{ reason: { id: number } }>('/api/v1/reason-codes', { nameAr, nameEn });

export const updateReasonCode = (id: number, patch: { isActive?: boolean }) =>
  api.patch<{ ok: boolean }>(`/api/v1/reason-codes/${id}`, patch);

export const reorderReasonCodes = (ids: number[]) =>
  api.post<{ ok: boolean }>('/api/v1/reason-codes/reorder', { ids });

// ===== النسخ الاحتياطي (أدمن) =====

export const listBackups = () =>
  api.get<{ backups: BackupInfo[] }>('/api/v1/backups').then((r) => r.backups);

export const createBackup = () =>
  api.post<{ backup: BackupInfo }>('/api/v1/backups').then((r) => r.backup);

export const restoreBackup = (name: string) =>
  api.post<{ restored: string; counts: Record<string, number> }>(`/api/v1/backups/${encodeURIComponent(name)}/restore`);

export const deleteBackup = (name: string) =>
  api.delete<void>(`/api/v1/backups/${encodeURIComponent(name)}`);

/** تنزيل النسخة — window.open بنفس قناة الجلسة */
export const downloadBackup = (name: string): void => {
  window.open(fileUrl(`/api/v1/backups/${encodeURIComponent(name)}/download`), '_blank');
};

/** حجم مقروء */
export const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} م.ب` : `${Math.max(1, Math.round(bytes / 1024))} ك.ب`;
