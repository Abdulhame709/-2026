import { ExclamationCircleFilled } from '@ant-design/icons';
import { Alert, App, Button, Tabs, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { api } from '@/shared/api/client';
import { getCompany, saveCompany } from './settingsClient';
import type { CompanySettings, ManagedUser } from './settingsClient';
import { UsersTab } from './UsersTab';
import { ReasonsTab } from './ReasonsTab';
import { CompanyTab } from './CompanyTab';
import { BackupTab } from './BackupTab';
import { AuditTab } from './AuditTab';

/**
 * الإعدادات والإدارة — وثيقة التصميم §10، كلها حقيقية (Module 6):
 * المستخدمون وسجل التدقيق (Module 1) + الأسباب وبيانات الشركة والنسخ الاحتياطي
 * (Module 6). حماية الأدوار فعلياً: المُطالِع رسالة صلاحيات، المحاسب الشركة
 * والأسباب، المدير الكل.
 */

export function SettingsPage() {
  const { hasRole, logout } = useAuth();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanySettings | null>(null);

  const isAdmin = hasRole('admin');
  const isStaff = hasRole('admin', 'reconciler');

  // بيانات الشركة — للترويسة والتقارير
  useEffect(() => {
    if (!isStaff) return;
    getCompany()
      .then(setCompany)
      .catch(() => message.error('تعذر جلب بيانات الشركة'));
  }, [isStaff, message]);

  const updateCompany = (patch: Partial<CompanySettings>) => {
    if (!company) return;
    const next = { ...company, ...patch };
    saveCompany(next)
      .then(setCompany)
      .then(() => message.success('حُفظت الإعدادات على الخادم'))
      .catch((e: { messageAr?: string; message?: string }) =>
        message.error(e?.messageAr ?? e?.message ?? 'فشل الحفظ — أعد المحاولة'),
      );
  };

  const refreshUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const data = await api.get<{ users: ManagedUser[] }>('/api/v1/users');
      setUsers(data.users);
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'فشل تحميل المستخدمين');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // جلب المستخدمين من الخادم عند دخول المدير التبويب
  useEffect(() => {
    if (isAdmin) refreshUsers();
  }, [isAdmin, refreshUsers]);

  const tabItems = useMemo(() => {
    const items: { key: string; label: string; children: React.ReactNode }[] = [];

    if (isAdmin) {
      items.push({
        key: 'users',
        label: 'المستخدمون',
        children: usersError ? (
          <Alert
            type="error"
            showIcon
            message={usersError}
            description="جلستك لم تُحفظ في إطار المعاينة (المتصفح منع كوكي الجلسة). اضغط «إعادة تسجيل الدخول» — والنظام الآن سيعمل بقناة جلسة بديلة تلقائياً داخل الإطار."
            action={
              <Button
                size="small"
                type="primary"
                onClick={() => logout().finally(() => navigate('/login', { replace: true }))}
              >
                إعادة تسجيل الدخول
              </Button>
            }
          />
        ) : (
          <UsersTab users={users} loading={usersLoading} onRefresh={refreshUsers} />
        ),
      });
    }
    items.push({
      key: 'reasons',
      label: 'رموز الأسباب',
      children: <ReasonsTab canManage={isAdmin} />,
    });
    if (company) {
      items.push({
        key: 'company',
        label: 'بيانات الشركة والعملات',
        children: <CompanyTab settings={company} onUpdate={updateCompany} onLogoUpdated={setCompany} />,
      });
    }
    if (isAdmin) {
      items.push({
        key: 'backup',
        label: 'النسخ الاحتياطي',
        children: <BackupTab />, // يدير النسخ من الخادم بنفسه (إنشاء/تنزيل/استرجاع)
      });
      items.push({
        key: 'audit',
        label: 'سجل التدقيق',
        children: <AuditTab />, // يجلِب من الخادم بنفسه (ترقيم صفحات حقيقي)
      });
    }
    return items;
  }, [isAdmin, users, usersLoading, usersError, refreshUsers, company, updateCompany]);

  // المُطالِع: الشاشة ظاهرة في التنقل لكن المحتوى الإداري محمي (§10.4)
  if (!isStaff) {
    return (
      <section aria-label="الإعدادات" style={{ padding: 24 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          الإعدادات
        </Typography.Title>
        <Alert
          type="warning"
          showIcon
          icon={<ExclamationCircleFilled aria-hidden="true" />}
          message="لا تملك صلاحية الوصول لإعدادات النظام"
          description="هذا القسم مخصص لمدير النظام والمحاسب المطابق. دورك الحالي (مُطالِع) يتيح استعراض الجلسات والتقارير والأرشيف فقط — إن كنت تحتاج صلاحيات أعلى تواصل مع مدير النظام."
        />
      </section>
    );
  }

  return (
    <section aria-label="الإعدادات والإدارة" className="settings-page">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        الإعدادات والإدارة
      </Typography.Title>
      <Tabs defaultActiveKey={isAdmin ? 'users' : 'company'} items={tabItems} size="large" />
      {!isAdmin && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          تبويبات المستخدمين والنسخ الاحتياطي وسجل التدقيق متاحة لمدير النظام فقط.
        </Typography.Text>
      )}
    </section>
  );
}

// ملاحظة: الأنواع والتسميات مركزية في settingsClient.ts (استُوردت مباشرة في كل تبويب)
