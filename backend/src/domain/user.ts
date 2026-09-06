/** الأدوار والأنواع المعددة — مرآة لأنواع PostgreSQL (user_role) */
export type UserRole = 'admin' | 'reconciler' | 'viewer';

export const ROLES: readonly UserRole[] = ['admin', 'reconciler', 'viewer'] as const;

/** مستخدم المجال النقي — بلا أي اعتماد على قاعدة البيانات أو Express */
export interface User {
  id: number;
  username: string;
  passwordHash: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
}

/** المستخدم كما يُعرض للعميل — بلا تجزئة كلمة المرور إطلاقاً */
export interface PublicUser {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  mustChangePassword: boolean;
  isActive: boolean;
}
