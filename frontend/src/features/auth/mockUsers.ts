/**
 * أنواع المستخدم المشتركة — كانت في mockUsers وتحولت لأنواع الخادم الحقيقية.
 * (المستخدم يأتي من GET /auth/me — نفس حقول PublicUser في الخادم.)
 */
import type { UserRoleName } from './roles';

export type Role = UserRoleName;

export interface AppUser {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  mustChangePassword?: boolean;
  isActive?: boolean;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'مدير النظام',
  reconciler: 'محاسب مطابِق',
  viewer: 'مُطالِع',
};

/** حسابات المعاينة فقط (تُعرض في شاشة الدخول للتعبئة السريعة) */
export const DEMO_ACCOUNTS = [
  { username: 'admin', password: 'Admin@2026', fullName: 'أحمد المدير', role: 'admin' as Role },
  { username: 'reconciler', password: 'Recon@2026', fullName: 'سامي المحاسب', role: 'reconciler' as Role },
  { username: 'viewer', password: 'Viewer@2026', fullName: 'منى المُطالعة', role: 'viewer' as Role },
];
