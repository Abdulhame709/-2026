import { BellOutlined, LockOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Avatar, Badge, Button, Dropdown, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { ROLE_LABELS } from '@/features/auth/mockUsers';
import { ChangePasswordModal } from '@/features/auth/ChangePasswordModal';
import { AppSidebar } from './AppSidebar';

/**
 * الهيكل العام للتطبيق (App Shell) — وثيقة التصميم §0.5:
 * شريط جانبي يميناً + ترويسة (إشعارات + قائمة مستخدم) + منطقة محتوى (Outlet).
 * الخروج الآن حقيقي (يُبطل الجلسة في الخادم) — وتنبيه كلمة المرور المؤقتة (FR-1.4).
 */

const MOCK_NOTIFICATION_COUNT = 7; // وهمي — سيأتي من KPIs عند ربط وحدة الفروق

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [pwOpen, setPwOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const userMenu: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: `${user?.fullName ?? ''} — ${user ? ROLE_LABELS[user.role] : ''}`,
      disabled: true,
    },
    {
      key: 'password',
      icon: <LockOutlined />,
      label: 'تغيير كلمة المرور',
      onClick: () => setPwOpen(true), // حقيقية — POST /auth/change-password
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'تسجيل الخروج',
      danger: true,
      onClick: handleLogout,
    },
  ];

  return (
    <div className="app-shell">
      <AppSidebar />
      <div className="app-main">
        <header className="app-header">
          <div className="app-header-end">
            <Tooltip title={`${MOCK_NOTIFICATION_COUNT} فروق مفتوحة تحتاج متابعة`}>
              <Badge count={MOCK_NOTIFICATION_COUNT} size="small" offset={[-2, 2]}>
                <button
                  type="button"
                  className="app-header-icon-btn"
                  aria-label={`الإشعارات: ${MOCK_NOTIFICATION_COUNT} فروق مفتوحة`}
                  onClick={() => navigate('/discrepancies')}
                >
                  <BellOutlined aria-hidden="true" />
                </button>
              </Badge>
            </Tooltip>

            <Dropdown menu={{ items: userMenu }} placement="bottomLeft" trigger={['click']}>
              <button type="button" className="app-user-btn" aria-label="قائمة المستخدم">
                <Avatar size={28} style={{ backgroundColor: 'var(--color-primary)' }}>
                  {user?.fullName?.charAt(0) ?? '؟'}
                </Avatar>
                <span className="app-user-name">{user?.fullName}</span>
              </button>
            </Dropdown>
          </div>
        </header>
        {user?.mustChangePassword && (
          <Alert
            type="warning"
            showIcon
            role="alert"
            style={{ margin: '12px 24px 0' }}
            message="كلمة المرور الحالية مؤقتة"
            description="أنت تستخدم كلمة مرور أولية أنشأها المدير — غيّرها الآن للاستمرار بأمان."
            action={
              <Button size="small" type="primary" onClick={() => setPwOpen(true)}>
                تغيير الآن
              </Button>
            }
          />
        )}
        <main className="app-content" id="main-content">
          <Outlet />
        </main>
      </div>
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
