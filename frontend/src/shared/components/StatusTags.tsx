import { Tag } from 'antd';
import type { DiscrepancyStatus, SessionStatus } from '@/shared/types';

/**
 * شارات الحالات — قيم ثابتة موحدة في كل الشاشات (وثيقة التصميم §8.5).
 */

const SESSION_STATUS: Record<SessionStatus, { label: string; color: string }> = {
  in_progress: { label: 'قيد العمل', color: 'processing' },
  closed: { label: 'مغلقة', color: 'success' },
  reopened: { label: 'معاد فتحها', color: 'warning' },
};

export function SessionStatusTag({ status }: { status: SessionStatus }) {
  const s = SESSION_STATUS[status];
  return <Tag color={s.color}>{s.label}</Tag>;
}

const DISCREPANCY_STATUS: Record<DiscrepancyStatus, { label: string; bg: string; fg: string }> = {
  new: { label: 'جديد', bg: '#DBEAFE', fg: '#1E40AF' },
  in_progress: { label: 'قيد المتابعة', bg: '#FEF3C7', fg: '#92400E' },
  resolved: { label: 'محلول', bg: '#DCFCE7', fg: '#166534' },
  accepted: { label: 'مقبول', bg: '#E2E8F0', fg: '#334155' },
};

export function DiscrepancyStatusTag({ status }: { status: DiscrepancyStatus }) {
  const s = DISCREPANCY_STATUS[status];
  return (
    <span
      className="status-tag"
      style={{ backgroundColor: s.bg, color: s.fg }}
      aria-label={`الحالة: ${s.label}`}
    >
      {s.label}
    </span>
  );
}
