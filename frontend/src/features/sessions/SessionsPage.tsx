import { DeleteOutlined, EditOutlined, FileAddOutlined, ReloadOutlined } from '@ant-design/icons';
import { App, Button, Card, Col, Form, Input, InputNumber, Modal, Popconfirm, Progress, Row, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { CurrencyBadge } from '@/shared/components/CurrencyBadge';
import { SessionStatusTag } from '@/shared/components/StatusTags';
import { deleteSession, listSessions, updateSession } from './sessionsClient';
import type { SessionListItem } from './sessionsClient';
import type { CurrencyCode, SessionStatus } from '@/shared/types';

/**
 * قائمة جلسات المطابقة — متصلة بالخادم (Module 4): GET /sessions بنسب التقدم الحية.
 * فلاتر: طرف/عملة/حالة + بحث. النقر على صف → شاشة عمل المطابقة.
 */

type CurrencyFilter = CurrencyCode | 'all';
type StatusFilter = SessionStatus | 'all';

/** صف عرض مشتق من جلسة الخادم */
interface SessionRow {
  id: number;
  partnerName: string;
  currency: CurrencyCode;
  periodLabel: string;
  status: SessionStatus;
  matchRatePct: number | null;
  totalLines: number;
  openDiscrepancies: number;
  openDiscrepancyValue: number;
  creatorLabel: string;
  /** لشاشة التعديل: الافتتاحيان + هل هو مرحَّل آلياً (سبب التعديل يلزم عندها) */
  openingOurs: number | null;
  openingTheirs: number | null;
  carriedFromSessionId: number | null;
}

interface SessionEditValues {
  periodLabel: string;
  openingOurs: number | null;
  openingTheirs: number | null;
  openingAdjustReason?: string;
}

export function SessionsPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { hasRole } = useAuth();
  const [editTarget, setEditTarget] = useState<SessionRow | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm] = Form.useForm<SessionEditValues>();

  /** حفظ التعديل — الجلسة المفتوحة فقط (الخادم يرفض المغلقة برسالة واضحة) */
  const saveEdit = async () => {
    if (!editTarget) return;
    const values = await editForm.validateFields();
    setEditSaving(true);
    const patch: Parameters<typeof updateSession>[1] = { periodLabel: values.periodLabel };
    if (values.openingOurs !== editTarget.openingOurs) patch.openingOurs = values.openingOurs;
    if (values.openingTheirs !== editTarget.openingTheirs) patch.openingTheirs = values.openingTheirs;
    if (patch.openingOurs !== undefined || patch.openingTheirs !== undefined) {
      patch.openingAdjustReason = values.openingAdjustReason?.trim() || null;
    }
    updateSession(editTarget.id, patch)
      .then(() => {
        message.success(`حُفظ تعديل الجلسة #${editTarget.id}`);
        setEditTarget(null);
        load();
      })
      .catch((e: { messageAr?: string; message?: string }) => message.error(e?.messageAr ?? 'فشل حفظ التعديل'))
      .finally(() => setEditSaving(false));
  };

  /** الحذف — أدمن فقط وللجلسة الفارغة، وبتنبيه صريح قبل التنفيذ */
  const doDelete = (row: SessionRow) => {
    deleteSession(row.id)
      .then(() => {
        message.success(`حُذفت الجلسة #${row.id} (${row.periodLabel})`);
        load();
      })
      .catch((e: { messageAr?: string; message?: string }) => message.error(e?.messageAr ?? 'تعذر الحذف'));
  };

  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [partner, setPartner] = useState<string | 'all'>('all');
  const [currency, setCurrency] = useState<CurrencyFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');

  const load = useCallback(() => {
    setLoading(true);
    listSessions()
      .then((sessions) =>
        setRows(
          sessions.map((s: SessionListItem) => ({
            id: s.id,
            partnerName: s.partner.nameAr,
            currency: s.currencyCode,
            periodLabel: s.periodLabel,
            status: s.status,
            matchRatePct:
              s.progress.theirs.lineCount + s.progress.ours.lineCount > 0
                ? Math.round(s.progress.matchRatePct * 10) / 10
                : null,
            totalLines: s.progress.ours.lineCount + s.progress.theirs.lineCount,
            openDiscrepancies: s.progress.ours.leftoverCount + s.progress.theirs.leftoverCount,
            openDiscrepancyValue: s.progress.ours.leftover + s.progress.theirs.leftover,
            creatorLabel: s.createdAt.slice(0, 10),
            openingOurs: s.openingOurs ?? null,
            openingTheirs: s.openingTheirs ?? null,
            carriedFromSessionId: s.carriedFromSessionId ?? null,
          })),
        ),
      )
      .catch((e: { messageAr?: string; message?: string }) => message.error(e?.messageAr ?? 'تعذر جلب الجلسات'))
      .finally(() => setLoading(false));
  }, [message]);

  useEffect(load, [load]);

  const partnerOptions = useMemo(() => [...new Set(rows.map((r) => r.partnerName))], [rows]);

  const filtered = useMemo(() => {
    const q = search.trim();
    return rows.filter((s) => {
      if (partner !== 'all' && s.partnerName !== partner) return false;
      if (currency !== 'all' && s.currency !== currency) return false;
      if (status !== 'all' && s.status !== status) return false;
      if (q && !`${s.partnerName} ${s.periodLabel} ${s.id}`.includes(q)) return false;
      return true;
    });
  }, [rows, search, partner, currency, status]);

  const openSession = (row: SessionRow) => {
    navigate(`/sessions/${row.id}`);
  };

  const columns: ColumnsType<SessionRow> = [
    {
      title: 'الجلسة',
      key: 'session',
      render: (_, row) => (
        <span>
          <strong>#{row.id}</strong>{' '}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.periodLabel}
          </Typography.Text>
        </span>
      ),
      width: 110,
    },
    {
      title: 'الطرف',
      dataIndex: 'partnerName',
      key: 'partner',
      render: (name: string) => <strong>{name}</strong>,
    },
    {
      title: 'العملة',
      dataIndex: 'currency',
      key: 'currency',
      width: 85,
      render: (c: CurrencyCode) => <CurrencyBadge currency={c} />,
    },
    {
      title: 'الحالة',
      dataIndex: 'status',
      key: 'status',
      width: 115,
      render: (s: SessionStatus) => <SessionStatusTag status={s} />,
    },
    {
      title: 'نسبة المطابقة',
      dataIndex: 'matchRatePct',
      key: 'rate',
      width: 170,
      render: (rate: number | null, row) =>
        rate === null ? (
          <Typography.Text type="secondary">لم تُشغَّل بعد</Typography.Text>
        ) : (
          <span className="rate-cell financial-numbers">
            <Progress
              percent={rate}
              size="small"
              strokeColor={
                rate >= 95
                  ? 'var(--color-success)'
                  : rate >= 80
                    ? 'var(--color-primary)'
                    : 'var(--color-warning)'
              }
              showInfo={false}
              style={{ minWidth: 90, marginBottom: 0 }}
              aria-label={`نسبة المطابقة ${rate}%`}
            />
            <span>{rate}%</span>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              ({row.totalLines} بنداً)
            </Typography.Text>
          </span>
        ),
    },
    {
      title: 'فروق مفتوحة',
      key: 'disc',
      width: 150,
      render: (_, row) =>
        row.openDiscrepancies > 0 ? (
          <span className="financial-numbers disc-open">
            {row.openDiscrepancies} · {row.openDiscrepancyValue.toLocaleString('en-US')}
          </span>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'أُنشئت',
      dataIndex: 'creatorLabel',
      key: 'creator',
      width: 100,
      render: (label: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {label}
        </Typography.Text>
      ),
    },
    ...(hasRole('admin', 'reconciler')
      ? [
          {
            title: 'إجراءات',
            key: 'actions',
            width: 110,
            render: (_: unknown, row: SessionRow) => (
              <span onClick={(e) => e.stopPropagation()}>
              <Space size={4}>
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined aria-hidden="true" />}
                  aria-label={`تعديل الجلسة ${row.id}`}
                  onClick={(e) => {
                    e.stopPropagation(); // لا تخطف النقرة الصفُّ كله (فتح الجلسة)
                    setEditTarget(row);
                    editForm.setFieldsValue({
                      periodLabel: row.periodLabel,
                      openingOurs: row.openingOurs,
                      openingTheirs: row.openingTheirs,
                      openingAdjustReason: '',
                    });
                  }}
                  disabled={row.status === 'closed'}
                />
                {hasRole('admin') && row.status !== 'closed' && (
                  <Popconfirm
                    title="تحذف الجلسة نهائياً؟"
                    description={`سيُحذف سجل الجلسة #${row.id} (${row.periodLabel}) — لا يُقبل الحذف إلا لجلسة خالية من الكشوف والفروق. الإجراء يُوثَّق في سجل التدقيق.`}
                    okText="نعم احذفها"
                    okButtonProps={{ danger: true }}
                    cancelText="تراجع"
                    onConfirm={() => doDelete(row)}
                  >
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined aria-hidden="true" />}
                      aria-label={`حذف الجلسة ${row.id}`}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>
                )}
              </Space>
              </span>
            ),
          } as ColumnsType<SessionRow>[number],
        ]
      : []),
  ];

  return (
    <section aria-label="جلسات المطابقة" className="sessions-page">
      <div className="page-head">
        <Typography.Title level={4} style={{ margin: 0 }}>
          جلسات المطابقة
        </Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined aria-hidden="true" />} onClick={load} aria-label="تحديث القائمة" />
          <Button
            type="primary"
            icon={<FileAddOutlined aria-hidden="true" />}
            onClick={() => navigate('/sessions/new')}
          >
            جلسة مطابقة جديدة
          </Button>
        </Space>
      </div>

      <Card styles={{ body: { padding: 16 } }}>
        <Row gutter={[12, 12]} className="sessions-filters" role="search" aria-label="فلترة الجلسات">
          <Col xs={24} sm={12} md={7}>
            <Input.Search
              placeholder="بحث: طرف، فترة، رقم جلسة…"
              allowClear
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="بحث في الجلسات"
            />
          </Col>
          <Col xs={12} md={5}>
            <Select<string | 'all'>
              value={partner}
              onChange={setPartner}
              style={{ width: '100%' }}
              aria-label="فلترة بالمورد"
              options={[
                { value: 'all', label: 'كل الموردين' },
                ...partnerOptions.map((p) => ({ value: p, label: p })),
              ]}
            />
          </Col>
          <Col xs={6} md={4}>
            <Select<CurrencyFilter>
              value={currency}
              onChange={setCurrency}
              style={{ width: '100%' }}
              aria-label="فلترة بالعملة"
              options={[
                { value: 'all', label: 'كل العملات' },
                { value: 'YER', label: 'YER' },
                { value: 'USD', label: 'USD' },
                { value: 'SAR', label: 'SAR' },
              ]}
            />
          </Col>
          <Col xs={6} md={4}>
            <Select<StatusFilter>
              value={status}
              onChange={setStatus}
              style={{ width: '100%' }}
              aria-label="فلترة بالحالة"
              options={[
                { value: 'all', label: 'كل الحالات' },
                { value: 'in_progress', label: 'قيد العمل' },
                { value: 'closed', label: 'مغلقة' },
                { value: 'reopened', label: 'معاد فتحها' },
              ]}
            />
          </Col>
          <Col xs={24} md={4} className="sessions-count">
            <Typography.Text type="secondary">
              النتائج: <strong className="financial-numbers">{filtered.length}</strong> من{' '}
              {rows.length}
            </Typography.Text>
          </Col>
        </Row>

        <Table<SessionRow>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={filtered}
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          rowClassName="clickable-row"
          locale={{
            emptyText: (
              <div style={{ padding: 24 }} aria-live="polite">
                لا جلسات مطابقة للفلاتر الحالية —{' '}
                <Button type="link" size="small" onClick={() => navigate('/sessions/new')}>
                  أنشئ أول جلسة
                </Button>
              </div>
            ),
          }}
          onRow={(row) => ({
            onClick: () => openSession(row),
            onKeyDown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openSession(row);
              }
            },
            tabIndex: 0,
            role: 'button',
            'aria-label': `فتح جلسة ${row.partnerName} ${row.periodLabel} ${row.currency}`,
          })}
        />
      </Card>
          <Modal
        open={editTarget != null}
        title={`تعديل الجلسة #${editTarget?.id ?? ''} — ${editTarget?.partnerName ?? ''}`}
        okText="حفظ التعديل"
        cancelText="تراجع"
        confirmLoading={editSaving}
        onOk={saveEdit}
        onCancel={() => setEditTarget(null)}
        destroyOnHidden
      >
        <Form<SessionEditValues> form={editForm} layout="vertical">
          <Form.Item
            name="periodLabel"
            label="فترة المطابقة (YYYY-MM)"
            rules={[{ required: true, pattern: /^\d{4}-\d{2}$/, message: 'مثال: 2026-09' }]}
          >
            <Input maxLength={7} className="financial-numbers" />
          </Form.Item>
          <Form.Item name="openingOurs" label="الرصيد الافتتاحي عندنا">
            <InputNumber step={0.01} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="openingTheirs" label="الرصيد الافتتاحي عندهم">
            <InputNumber step={0.01} style={{ width: '100%' }} />
          </Form.Item>
          {editTarget?.carriedFromSessionId != null && (
            <Form.Item
              name="openingAdjustReason"
              label="سبب تعديل المرحَّل (إلزامي إن غيّرت أي افتتاحي)"
              extra="قاعدة D9: أي تعديل يدوي على رصيد مرحَّل آلياً له مبرر موثق في سجل التدقيق والتقرير"
            >
              <Input maxLength={500} placeholder="مثال: أُدرج إشعار دائن لم يظهر في الفترة السابقة" />
            </Form.Item>
          )}
          {editTarget?.status === 'closed' && (
            <Typography.Text type="danger">الجلسة مغلقة — أعد فتحها أولاً (أدمن) قبل أي تعديل</Typography.Text>
          )}
        </Form>
      </Modal>
    </section>
  );
}
