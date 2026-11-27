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
