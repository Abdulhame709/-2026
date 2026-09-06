import { RightOutlined } from '@ant-design/icons';

/**
 * بطاقة مؤشر رئيسي (KPI) — وثيقة التصميم §2.2:
 * رقم كبير + سطر مقارنة + نقطة لون دلالي + قابلة للنقر (تنقل لقائمة مرشحة).
 */

interface KpiCardProps {
  title: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'warning' | 'danger' | 'success';
  onClick?: () => void;
}

const TONE_COLORS = {
  default: 'var(--color-primary)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-error)',
} as const;

export function KpiCard({ title, value, sub, tone = 'default', onClick }: KpiCardProps) {
  const interactive = Boolean(onClick);
  return (
    <button
      type="button"
      className="kpi-card"
      onClick={onClick}
      disabled={!interactive}
      aria-label={interactive ? `${title}: ${value} — عرض التفاصيل` : `${title}: ${value}`}
    >
      <span className="kpi-card-title">
        <span className="kpi-dot" style={{ backgroundColor: TONE_COLORS[tone] }} aria-hidden="true" />
        {title}
      </span>
      <span className="kpi-card-value financial-numbers">{value}</span>
      {sub && <span className="kpi-card-sub">{sub}</span>}
      {interactive && (
        <RightOutlined className="kpi-card-arrow" aria-hidden="true" style={{ fontSize: 12 }} />
      )}
    </button>
  );
}
