import type { CurrencyCode } from '@/shared/types';

/**
 * شارة العملة — ألوانها ثابتة في كل النظام (وثيقة التصميم §0.2/§3.5):
 * YER كهرماني · USD أخضر · SAR أزرق.
 */

const CURRENCY_STYLES: Record<CurrencyCode, { bg: string; fg: string; label: string }> = {
  YER: { bg: '#FEF3C7', fg: '#92400E', label: 'YER' },
  USD: { bg: '#DCFCE7', fg: '#166534', label: 'USD' },
  SAR: { bg: '#DBEAFE', fg: '#1E40AF', label: 'SAR' },
};

export function CurrencyBadge({ currency }: { currency: CurrencyCode }) {
  const style = CURRENCY_STYLES[currency];
  return (
    <span
      className="currency-badge"
      style={{ backgroundColor: style.bg, color: style.fg }}
      aria-label={`العملة: ${currency}`}
    >
      {style.label}
    </span>
  );
}
