import { ProfileOutlined } from '@ant-design/icons';
import { Typography } from 'antd';

/**
 * شعار النظام — عنصر نائب حتى تسليم شعار الشركة (إعدادات FR-8.1).
 * size="large" لبطاقة الدخول، "small" للترويسة.
 */
export function BrandLogo({ size = 'small' }: { size?: 'small' | 'large' }) {
  const isLarge = size === 'large';
  return (
    <div className={`brand-logo brand-logo--${size}`}>
      <ProfileOutlined
        aria-hidden="true"
        style={{ fontSize: isLarge ? 40 : 22, color: 'var(--color-primary)' }}
      />
      <Typography.Text strong style={{ fontSize: isLarge ? 18 : 14 }}>
        مطابقة الكشوفات
      </Typography.Text>
    </div>
  );
}
