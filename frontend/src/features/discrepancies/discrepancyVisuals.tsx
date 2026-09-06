import { Tag } from 'antd';
import type { DiscrepancyType } from '@/shared/types';

/**
 * شارة نوع الفرق — دلالات ثابتة موحدة (وثيقة التصميم §8).
 * الأنواع "عندنا فقط / عنده فقط" تستخدمان لوني الحجز البنفسجي/الوردي.
 */

const TYPE_META: Record<DiscrepancyType, { label: string; bg: string; fg: string }> = {
  amount_diff: { label: 'فرق مبلغ', bg: '#FFFBEB', fg: '#92400E' },
  date_diff: { label: 'فرق تاريخ', bg: '#F1F5F9', fg: '#334155' },
  ref_diff: { label: 'فرق مرجع', bg: '#F1F5F9', fg: '#334155' },
  ours_only: { label: 'عندنا فقط', bg: '#F5F3FF', fg: '#5B21B6' },
  theirs_only: { label: 'عنده فقط', bg: '#FDF2F8', fg: '#9D174D' },
};

export function DiscrepancyTypeTag({ type }: { type: DiscrepancyType }) {
  const meta = TYPE_META[type];
  return (
    <span
      className="status-tag"
      style={{ backgroundColor: meta.bg, color: meta.fg }}
      aria-label={`النوع: ${meta.label}`}
    >
      {meta.label}
    </span>
  );
}

/** لون العمر — محايد حتى 14 يوماً، كهرماني حتى 30، أحمر بعدها (§8.5) */
export function ageColor(days: number): string {
  if (days >= 30) return 'var(--color-error)';
  if (days >= 14) return 'var(--color-warning)';
  return 'var(--color-text-secondary)';
}

export { Tag };
