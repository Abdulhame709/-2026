import { App, Button, Descriptions, Drawer, Empty, Input, List, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { CurrencyBadge } from '@/shared/components/CurrencyBadge';
import { DiscrepancyStatusTag } from '@/shared/components/StatusTags';
import { useAuth } from '@/app/AuthContext';
import { formatMoney } from '@/features/statements/import/statementValidation';
import { listSessions } from '@/features/sessions/sessionsClient';
import type { SessionListItem } from '@/features/sessions/sessionsClient';
import {
  addComment,
  ageInDays,
  carryDiscrepancy,
  deleteComment,
  listAssignees,
  listComments,
  listReasonCodes,
  updateDiscrepancy,
} from './discrepanciesClient';
import type { AssigneeUser, DiscrepancyComment, DiscrepancyFull, ReasonCode } from './discrepanciesClient';
import { DiscrepancyTypeTag, ageColor } from './discrepancyVisuals';

/**
 * لوحة تفاصيل الفرق المنزلقة — الحقيقية (Module 5 + تعليقات Module 7):
 * القيم المقارنة + ملاحظات الفريق (الجميع يعلّق — تُطبع في التقرير) + السبب الجاهز
 * + المسؤول + دورة الحالة (حل/قبول بملاحظة إلزامية) + الترحيل لجلسة مفتوحة بنفس الحساب.
 */

const ROLE_LABELS: Record<DiscrepancyComment['authorRole'], string> = {
  admin: 'مدير',
  reconciler: 'محاسب',
  viewer: 'مُطالع',
};

const commentTime = (iso: string): string => iso.slice(0, 16).replace('T', ' ');

interface DiscrepancyDrawerProps {
  row: DiscrepancyFull | null;
  onClose: () => void;
  onChanged: () => void;
}

export function DiscrepancyDrawer({ row, onClose, onChanged }: DiscrepancyDrawerProps) {
  const { message } = App.useApp();
  const { hasRole, user } = useAuth();
  const canWrite = hasRole('admin', 'reconciler');

  const [reasons, setReasons] = useState<ReasonCode[]>([]);
  const [assignees, setAssignees] = useState<AssigneeUser[]>([]);
  const [openSessions, setOpenSessions] = useState<SessionListItem[]>([]);
  const [carryTarget, setCarryTarget] = useState<number | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [comments, setComments] = useState<DiscrepancyComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [addingComment, setAddingComment] = useState(false);

  useEffect(() => {
    listReasonCodes().then(setReasons).catch(() => setReasons([]));
    listAssignees().then(setAssignees).catch(() => setAssignees([]));
  }, []);

  // تعليقات الفرق — تُحمَّل عند فتح/تبديل الفرق (الجميع يقرأها ويضيف عليها)
  useEffect(() => {
    setComments([]);
    setNewComment('');
    if (!row) return;
    setCommentsLoading(true);
    listComments(row.id)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false));
  }, [row?.id]);

  // جلسات الترحيل المرشحة: مفتوحة لنفس الحساب وغير جلسة الفرق نفسها
  useEffect(() => {
    setCarryTarget(null);
    if (!row) return;
    listSessions()
      .then((all) =>
        setOpenSessions(
          all.filter((s) => s.accountId === row.accountId && s.id !== row.sessionId && s.status !== 'closed'),
        ),
      )
      .catch(() => setOpenSessions([]));
  }, [row]);

  // تصفير الملاحظة عند تبديل الفرق
  useEffect(() => setResolutionNote(''), [row?.id]);

  const age = useMemo(() => (row ? ageInDays(row.createdAt) : 0), [row]);

  /** إضافة ملاحظة — متاحة لكل الأدوار (قرار المالك) وتظهر في التقرير المطبوع */
  const submitComment = () => {
    if (!row) return;
    const body = newComment.trim();
    if (!body) {
      message.warning('اكتب الملاحظة أولاً');
      return;
    }
    setAddingComment(true);
    addComment(row.id, body)
      .then((c) => {
        setComments((prev) => [...prev, c]);
        setNewComment('');
        message.success('أُضيفت الملاحظة — ستظهر في تقرير الجلسة');
      })
      .catch((e: { messageAr?: string; message?: string }) => message.error(e?.messageAr ?? 'تعذر إضافة الملاحظة'))
      .finally(() => setAddingComment(false));
  };

  /** الحذف: صاحب الملاحظة أو المدير فقط (الخادم يتحقق أيضاً) */
  const removeComment = (commentId: number) => {
    deleteComment(commentId)
      .then(() => {
        setComments((prev) => prev.filter((c) => c.id !== commentId));
        message.success('حُذفت الملاحظة');
      })
      .catch((e: { messageAr?: string; message?: string }) => message.error(e?.messageAr ?? 'تعذر الحذف'));
  };

  const save = (patch: Parameters<typeof updateDiscrepancy>[1], okMsg: string) => {
    if (!row) return;
    setSaving(true);
    updateDiscrepancy(row.id, patch)
      .then(() => {
        message.success(okMsg);
        onChanged();
      })
      .catch((e: { messageAr?: string; message?: string }) => message.error(e?.messageAr ?? 'فشل الحفظ'))
      .finally(() => setSaving(false));
  };

  const resolveAs = (status: 'resolved' | 'accepted') => {
    const note = resolutionNote.trim();
    if (note.length < 5) {
      message.warning('اكتب ملاحظة الحل أولاً (5 أحرف على الأقل) — الذاكرة المؤسسية لا تُختصر');
      return;
    }
    save({ status, resolutionNote: note }, status === 'resolved' ? 'حُلّ الفرق' : 'قُبل الفرق كخسارة/تسوية موثقة');
  };

  const doCarry = () => {
    if (!row || !carryTarget) return;
    setSaving(true);
    carryDiscrepancy(row.id, carryTarget)
      .then(() => {
        message.success(`مُرحَّل للجلسة #${carryTarget} — سيظهر فيها كمتبقٍ معروف`);
        setSaving(false);
        onChanged();
      })
      .catch((e: { messageAr?: string; message?: string }) => {
        setSaving(false);
        message.error(e?.messageAr ?? 'فشل الترحيل');
      });
  };

  if (!row) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      width={520}
      title={
        <Space>
          <span>الفرق #{row.id}</span>
          <DiscrepancyTypeTag type={row.type} />
          <DiscrepancyStatusTag status={row.status} />
        </Space>
      }
    >
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label="الطرف / الفترة">
          <strong>{row.partnerName}</strong> · <span className="financial-numbers">{row.periodLabel}</span> ·{' '}
          <CurrencyBadge currency={row.currencyCode} />
        </Descriptions.Item>
        <Descriptions.Item label="البند">
          {row.lineDescription ?? '—'}
          {row.lineDate && (
            <Typography.Text type="secondary" className="financial-numbers" style={{ fontSize: 12 }}>
              {' '}
              ({row.lineDate})
            </Typography.Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="القيم المقارنة">
          <span className="financial-numbers">
            عندنا {row.ourAmount != null ? formatMoney(row.ourAmount) : '—'} · عندهم{' '}
            {row.theirAmount != null ? formatMoney(row.theirAmount) : '—'}
            {row.diffAmount != null && row.type !== 'ours_only' && row.type !== 'theirs_only'
              ? ` · الفرق ${formatMoney(row.diffAmount)}`
              : ''}
          </span>
        </Descriptions.Item>
        <Descriptions.Item label="العمر">
          <span className="financial-numbers" style={{ color: ageColor(age), fontWeight: 600 }}>
            {age} يوماً
          </span>
        </Descriptions.Item>
        {row.carriedToSessionId && (
          <Descriptions.Item label="مُرحَّل إلى">
            <Tag color="orange">جلسة #{row.carriedToSessionId}</Tag>
          </Descriptions.Item>
        )}
      </Descriptions>

      {/* ===== ملاحظات الفريق (Module 7): الجميع يعلّق — وتُطبع في تقرير الجلسة ===== */}
      <Typography.Title level={5} style={{ marginTop: 20, marginBottom: 8 }}>
        ملاحظات الفريق{' '}
        <Typography.Text type="secondary" className="financial-numbers">
          ({comments.length})
        </Typography.Text>
      </Typography.Title>
      {commentsLoading ? (
        <Typography.Text type="secondary">تُحمَّل الملاحظات…</Typography.Text>
      ) : comments.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ fontSize: 13 }}>لا ملاحظات بعد — سجّل هنا اتفاقك مع المورد أو سبب قبول الفرق</span>}
        />
      ) : (
        <List
          size="small"
          dataSource={comments}
          renderItem={(c) => (
            <List.Item
              actions={
                user && (user.id === c.authorId || user.role === 'admin')
                  ? [
                      <Popconfirm
                        key="del"
                        title="تحذف هذه الملاحظة؟"
                        okText="حذف"
                        cancelText="تراجع"
                        onConfirm={() => removeComment(c.id)}
                      >
                        <Button type="text" size="small" danger aria-label={`حذف ملاحظة ${c.id}`}>
                          حذف
                        </Button>
                      </Popconfirm>,
                    ]
                  : undefined
              }
            >
              <List.Item.Meta
                title={
                  <Space wrap size={6}>
                    <span>{c.authorName}</span>
                    <Tag style={{ fontSize: 11, lineHeight: '16px', marginInlineEnd: 0 }}>
                      {ROLE_LABELS[c.authorRole]}
                    </Tag>
                    <Typography.Text type="secondary" className="financial-numbers" style={{ fontSize: 11, fontWeight: 400 }}>
                      {commentTime(c.createdAt)}
                    </Typography.Text>
                  </Space>
                }
                description={<span style={{ whiteSpace: 'pre-wrap', color: 'var(--color-text)' }}>{c.body}</span>}
              />
            </List.Item>
          )}
        />
      )}
      <Input.TextArea
        value={newComment}
        onChange={(e) => setNewComment(e.target.value)}
        placeholder="أضف ملاحظة للفريق — ماذا اتفقتم مع المورد؟ (تظهر في التقرير المطبوع)"
        rows={2}
        maxLength={2000}
        showCount
        style={{ marginTop: 8 }}
        aria-label="ملاحظة جديدة"
      />
      <Button
        type="primary"
        ghost
        size="small"
        loading={addingComment}
        disabled={!newComment.trim()}
        onClick={submitComment}
        style={{ marginTop: 8 }}
      >
        أضف الملاحظة
      </Button>

      {canWrite && (
        <>
          <Typography.Title level={5} style={{ marginTop: 20 }}>
            الإدارة
          </Typography.Title>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Select<number | null>
              style={{ width: '100%' }}
              value={row.reasonCodeId}
              placeholder="سبب الفرق (من القائمة الجاهزة)"
              allowClear
              onChange={(v) => save({ reasonCodeId: v ?? null }, 'حُفظ السبب')}
              options={reasons.map((r) => ({ value: r.id, label: r.nameAr }))}
              aria-label="سبب الفرق"
            />
            <Select<number | null>
              style={{ width: '100%' }}
              value={row.assigneeId}
              placeholder="المسؤول عن المتابعة"
              allowClear
              onChange={(v) => save({ assigneeId: v ?? null }, 'حُفظ المسؤول')}
              options={assignees.map((a) => ({ value: a.id, label: `${a.fullName} (${a.role === 'admin' ? 'أدمن' : 'مطابِق'})` }))}
              aria-label="المسؤول"
            />
            {row.status === 'new' && (
              <Button block onClick={() => save({ status: 'in_progress' }, 'بدأت المتابعة')}>
                بدء المتابعة
              </Button>
            )}
            <Input.TextArea
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              placeholder="ملاحظة الحل — إلزامية عند الحل/القبول (كيف انتهى الفرق؟)"
              rows={2}
              maxLength={500}
              aria-label="ملاحظة الحل"
            />
            <Space wrap>
              <Button type="primary" loading={saving} onClick={() => resolveAs('resolved')}>
                حل الفرق
              </Button>
              <Button loading={saving} onClick={() => resolveAs('accepted')}>
                قبول (تسوية موثقة)
              </Button>
            </Space>

            <div style={{ borderTop: '1px dashed var(--color-border)', paddingTop: 12 }}>
              <Typography.Text strong>الترحيل للجلسة التالية</Typography.Text>
              <Space.Compact style={{ width: '100%', marginTop: 8 }}>
                <Select<number>
                  style={{ width: '100%' }}
                  value={carryTarget}
                  placeholder="اختر جلسة مفتوحة لنفس الحساب…"
                  onChange={setCarryTarget}
                  options={openSessions.map((s) => ({ value: s.id, label: `جلسة #${s.id} — ${s.periodLabel}` }))}
                  aria-label="جلسة الترحيل"
                />
                <Button type="primary" ghost disabled={!carryTarget} loading={saving} onClick={doCarry}>
                  ترحيل
                </Button>
              </Space.Compact>
              {openSessions.length === 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  لا جلسات مفتوحة لهذا الحساب — أنشئ جلسة الفترة التالية أولاً
                </Typography.Text>
              )}
            </div>
          </Space>
        </>
      )}
      {!canWrite && (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
          للمطالعة فقط — الإدارة لأدمن/مُطابِق.
        </Typography.Text>
      )}
    </Drawer>
  );
}
