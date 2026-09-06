import { ReloadOutlined } from '@ant-design/icons';
import { App, Button, Card, Col, Input, Row, Select, Space, Switch, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CurrencyBadge } from '@/shared/components/CurrencyBadge';
import { DiscrepancyStatusTag } from '@/shared/components/StatusTags';
import {
  ageInDays,
  listDiscrepancies,
} from './discrepanciesClient';
import type { DiscrepancyFull, DiscrepancyStatus, DiscrepancyType } from './discrepanciesClient';
import { DiscrepancyTypeTag, ageColor } from './discrepancyVisuals';
import { DiscrepancyDrawer } from './DiscrepancyDrawer';

/**
 * إدارة الفروق — الحقيقية (Module 5): تُولَّد آلياً عند إغلاق الجلسات،
 * قائمة بفلاتر غنية + لوحة تفاصيل منزلقة، تتبع كل فرق حتى الحل (Q12).
 * فلتر ?session=N من شاشة العمل (روابط الإغلاق).
 */

interface DiscRow {
  id: number;
  partnerName: string;
  periodLabel: string;
  currency: DiscrepancyFull['currencyCode'];
  type: DiscrepancyType;
  summary: string;
  diffAmount: number | null;
  reasonCodeName: string | null;
  assigneeName: string | null;
  ageDays: number;
  status: DiscrepancyStatus;
}

export function DiscrepanciesPage() {
  const { message } = App.useApp();
  const [searchParams] = useSearchParams();
  const sessionFilter = searchParams.get('session') ? Number(searchParams.get('session')) : null;

  const [rows, setRows] = useState<DiscRow[]>([]);
  const [full, setFull] = useState<DiscrepancyFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [partner, setPartner] = useState<string | 'all'>('all');
  const [currency, setCurrency] = useState<string | 'all'>('all');
  const [type, setType] = useState<DiscrepancyType | 'all'>('all');
  const [status, setStatus] = useState<DiscrepancyStatus | 'all'>('all');
  const [assignee, setAssignee] = useState<string | 'all'>('all');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    listDiscrepancies(sessionFilter ? { sessionId: sessionFilter } : {})
      .then((list) => {
        setFull(list);
        setRows(
          list.map((d) => ({
            id: d.id,
            partnerName: d.partnerName,
            periodLabel: d.periodLabel,
            currency: d.currencyCode,
            type: d.type,
            summary:
              d.lineDescription ??
              (d.type === 'ours_only' ? 'بند عندنا بلا مقابل' : 'بند عندهم بلا مقابل'),
            diffAmount: d.diffAmount,
            reasonCodeName: d.reasonCodeName,
            assigneeName: d.assigneeName,
            ageDays: ageInDays(d.createdAt),
            status: d.status,
          })),
        );
      })
      .catch((e: { messageAr?: string; message?: string }) => message.error(e?.messageAr ?? 'تعذر جلب الفروق'))
      .finally(() => setLoading(false));
  }, [sessionFilter, message]);

  useEffect(load, [load]);

  const partners = useMemo(() => [...new Set(rows.map((r) => r.partnerName))], [rows]);
  const assignees = useMemo(() => [...new Set(rows.map((r) => r.assigneeName).filter((n): n is string => Boolean(n)))], [rows]);

  const filtered = useMemo(() => {
    const q = search.trim();
    return rows
      .filter((r) => {
        if (partner !== 'all' && r.partnerName !== partner) return false;
        if (currency !== 'all' && r.currency !== currency) return false;
        if (type !== 'all' && r.type !== type) return false;
        if (status !== 'all' && r.status !== status) return false;
        if (assignee !== 'all' && r.assigneeName !== assignee) return false;
        if (onlyOverdue && r.ageDays < 30) return false;
        if (q && !`${r.partnerName} ${r.summary} ${r.periodLabel} ${r.id}`.includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.ageDays - a.ageDays);
  }, [rows, search, partner, currency, type, status, assignee, onlyOverdue]);

  const openCount = rows.filter((r) => r.status === 'new' || r.status === 'in_progress').length;
  const overdueCount = rows.filter((r) => r.ageDays >= 30 && (r.status === 'new' || r.status === 'in_progress')).length;

  const selectedFull = full.find((f) => f.id === selectedId) ?? null;

  const columns: ColumnsType<DiscRow> = [
    {
      title: '#',
      dataIndex: 'id',
      key: 'id',
      width: 50,
      render: (v: number) => <span className="financial-numbers line-no">{v}</span>,
    },
    {
      title: 'الطرف',
      dataIndex: 'partnerName',
      key: 'partner',
      render: (name: string, row) => (
        <span>
          <strong>{name}</strong>{' '}
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {row.periodLabel}
          </Typography.Text>
        </span>
      ),
    },
    {
      title: 'النوع',
      dataIndex: 'type',
      key: 'type',
      width: 105,
      render: (t: DiscrepancyType) => <DiscrepancyTypeTag type={t} />,
    },
    { title: 'الوصف', dataIndex: 'summary', key: 'summary', ellipsis: true },
    {
      title: 'المبلغ',
      dataIndex: 'diffAmount',
      key: 'diff',
      width: 140,
      render: (v: number | null, row) => (
        <span className="financial-numbers">
          {v != null ? v.toLocaleString('en-US') : '—'} <CurrencyBadge currency={row.currency} />
        </span>
      ),
    },
    {
      title: 'السبب',
      key: 'reason',
      width: 190,
      render: (_, row) =>
        row.reasonCodeName ? (
          <Typography.Text style={{ fontSize: 12 }}>{row.reasonCodeName}</Typography.Text>
        ) : (
          <Typography.Text type="warning" style={{ fontSize: 12 }}>
            غير محدد ⚠
          </Typography.Text>
        ),
    },
    {
      title: 'المسؤول',
      dataIndex: 'assigneeName',
      key: 'assignee',
      width: 110,
      render: (name: string | null) => name ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'العمر',
      dataIndex: 'ageDays',
      key: 'age',
      width: 90,
      render: (days: number) => (
        <span className="financial-numbers" style={{ color: ageColor(days), fontWeight: 600 }}>
          {days} يوماً
        </span>
      ),
    },
    {
      title: 'الحالة',
      dataIndex: 'status',
      key: 'status',
      width: 115,
      render: (s: DiscrepancyStatus) => <DiscrepancyStatusTag status={s} />,
    },
  ];

  return (
    <section aria-label="إدارة الفروق" className="disc-page">
      <div className="page-head">
        <Typography.Title level={4} style={{ margin: 0 }}>
          الفروق{sessionFilter ? ` — جلسة #${sessionFilter}` : ''}
        </Typography.Title>
        <Space size={16}>
          <Typography.Text type="secondary">
            مفتوحة: <strong className="financial-numbers">{openCount}</strong>
          </Typography.Text>
          <Typography.Text type="danger">
            متأخرة: <strong className="financial-numbers">{overdueCount}</strong>
          </Typography.Text>
          <Button icon={<ReloadOutlined aria-hidden="true" />} onClick={load} aria-label="تحديث" />
        </Space>
      </div>

      <Card styles={{ body: { padding: 16 } }}>
        <Row gutter={[12, 12]} className="sessions-filters" role="search" aria-label="فلترة الفروق">
          <Col xs={24} sm={12} md={6}>
            <Input.Search
              placeholder="بحث: وصف، طرف، فترة…"
              allowClear
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="بحث في الفروق"
            />
          </Col>
          <Col xs={12} md={5}>
            <Select<string | 'all'>
              value={partner}
              onChange={setPartner}
              style={{ width: '100%' }}
              aria-label="فلترة بالطرف"
              options={[{ value: 'all', label: 'كل الأطراف' }, ...partners.map((p) => ({ value: p, label: p }))]}
            />
          </Col>
          <Col xs={8} md={3}>
            <Select<string | 'all'>
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
          <Col xs={8} md={4}>
            <Select<DiscrepancyStatus | 'all'>
              value={status}
              onChange={setStatus}
              style={{ width: '100%' }}
              aria-label="فلترة بالحالة"
              options={[
                { value: 'all', label: 'كل الحالات' },
                { value: 'new', label: 'جديد' },
                { value: 'in_progress', label: 'قيد المتابعة' },
                { value: 'resolved', label: 'محلول' },
                { value: 'accepted', label: 'مقبول' },
              ]}
            />
          </Col>
          <Col xs={8} md={4}>
            <Select<DiscrepancyType | 'all'>
              value={type}
              onChange={setType}
              style={{ width: '100%' }}
              aria-label="فلترة بالنوع"
              options={[
                { value: 'all', label: 'كل الأنواع' },
                { value: 'amount_diff', label: 'فرق مبلغ' },
                { value: 'date_diff', label: 'فرق تاريخ' },
                { value: 'ref_diff', label: 'فرق مرجع' },
                { value: 'ours_only', label: 'عندنا فقط' },
                { value: 'theirs_only', label: 'عنده فقط' },
              ]}
            />
          </Col>
          <Col xs={12} md={2}>
            <Select<string | 'all'>
              value={assignee}
              onChange={setAssignee}
              style={{ width: '100%' }}
              aria-label="فلترة بالمسؤول"
              options={[{ value: 'all', label: 'كل المسؤولين' }, ...assignees.map((a) => ({ value: a, label: a }))]}
            />
          </Col>
          <Col xs={12} md={24}>
            <Space>
              <Switch checked={onlyOverdue} onChange={setOnlyOverdue} aria-label="عرض المتجاوزة 30 يوماً فقط" />
              <Typography.Text>المتجاوزة 30 يوماً فقط</Typography.Text>
              <Button
                size="small"
                type="text"
                onClick={() => {
                  setSearch('');
                  setPartner('all');
                  setCurrency('all');
                  setType('all');
                  setStatus('all');
                  setAssignee('all');
                  setOnlyOverdue(false);
                }}
              >
                مسح الفلاتر
              </Button>
              <Typography.Text type="secondary">
                النتائج: <strong className="financial-numbers">{filtered.length}</strong>
              </Typography.Text>
            </Space>
          </Col>
        </Row>

        <Table<DiscRow>
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
                لا فروق مطابقة للفلاتر — هذه النتيجة الصحية المرغوبة 😊
              </div>
            ),
          }}
          onRow={(row) => ({
            onClick: () => setSelectedId(row.id),
            onKeyDown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelectedId(row.id);
              }
            },
            tabIndex: 0,
            role: 'button',
            'aria-label': `فتح تفاصيل الفرق ${row.id} — ${row.summary}`,
          })}
        />
      </Card>

      <DiscrepancyDrawer row={selectedFull} onClose={() => setSelectedId(null)} onChanged={load} />
    </section>
  );
}
