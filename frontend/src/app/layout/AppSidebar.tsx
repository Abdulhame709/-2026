import {
  AlertOutlined,
  DashboardOutlined,
  FileSyncOutlined,
  FileTextOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Menu } from 'antd';
import type { MenuProps } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { BrandLogo } from '@/shared/components/BrandLogo';

/**
 * الشريط الجانبي (يمين الشاشة في RTL) — وثيقة التصميم §0.5.
 * العناصر المعطلة تفتح صفحة "قيد البناء" حتى تُبنى شاشاتها في خطواتها.
 */

const MENU_ITEMS: NonNullable<MenuProps['items']> = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: 'لوحة المؤشرات' },
  { key: '/sessions', icon: <FileSyncOutlined />, label: 'جلسات المطابقة' },
  { key: '/partners', icon: <TeamOutlined />, label: 'الأطراف والحسابات' },
  { key: '/discrepancies', icon: <AlertOutlined />, label: 'الفروق' },
  { key: '/reports', icon: <FileTextOutlined />, label: 'التقارير والأرشيف' },
  { key: '/settings', icon: <SettingOutlined />, label: 'الإعدادات' },
];

const MENU_PATHS = MENU_ITEMS.map((item) => String(item!.key));

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  const activeKey =
    MENU_PATHS.find((path) => location.pathname.startsWith(path)) ?? '/dashboard';

  const onMenuClick: MenuProps['onClick'] = ({ key }) => navigate(String(key));

  return (
    <aside className="app-sidebar" aria-label="التنقل الرئيسي">
      <div className="app-sidebar-brand">
        <BrandLogo size="small" />
      </div>
      <Menu
        mode="inline"
        theme="dark"
        selectedKeys={[activeKey]}
        items={MENU_ITEMS}
        onClick={onMenuClick}
        style={{ borderInlineEnd: 'none' }}
      />
      <div className="app-sidebar-footer">الإصدار 0.1.0 — معاينة</div>
    </aside>
  );
}
