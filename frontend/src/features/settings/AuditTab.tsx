import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Col, Input, Row, Select, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/shared/api/client';
import { AUDIT_ACTION_LABELS } from './settingsClient';
import type { AuditEntry } from './settingsClient';

/**
 * سجل التدقيق — قراءة فقط إطلاقاً (FR-7.2) — متصل بالخادم:
 * GET /api/v1/audit-log?limit=8&offset=&action=&search=  (ترقيم صفحات حقيقي).
 * CSV يُصدِّر الصفحة الحالية كما هي (تصدير Excel الخلفي في Phase 9).
 */

interface ApiAuditItem {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
  actor: { username: string; fullName: string } | null;
}

const PAGE_SIZE = 8;

function friendlyEntity(entityType: string | null, entityId: string | null): string {
  if (!entityType) return '—';
  if (entityType === 'user') return `مستخدم @${entityId}`;
  if (entityType === 'auth_session') return `جلسة ${entityId?.slice(0, 8) ?? ''}`;
  return `${entityType} ${entityId ?? ''}`;
}

function compactPayload(before: unknown, after: unknown): string {
  const pick = (v: unknown) => {
    if (v === null || v === undefined) return null;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };
  const a = pick(after);
  const b = pick(before);
  const raw = a && b ? `${b} ← ${a}` : (a ?? b ?? '');
  return raw.length > 90 ? `${raw.slice(0, 90)}…` : raw;
}

function mapItem(item: ApiAuditItem): AuditEntry {
  const d = new Date(item.createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const timeLabel = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return {
    id: item.id,
    actorName: item.actor?.fullName ?? '—',
    timeLabel,
    action: item.action,
    entity: friendlyEntity(item.entityType, item.entityId),
    detail: compactPayload(item.before, item.after) || '—',
    ip: item.ip ?? '—',
  };
}

export function AuditTab() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<string | 'all'>('all');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  const fetchPage = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      });
      if (action !== 'all') params.set('action', action);
      if (appliedSearch.trim()) params.set('search', appliedSearch.trim());
      const data = await api.get<{ total: number; items: ApiAuditItem[] }>(
        `/api/v1/audit-log?${params.toString()}`,
      );
      setRows(data.items.map(mapItem));
      setTotal(data.total);
    } catch (err) {
      console.error('audit-log:', err);
    } finally {
      setLoading(false);
    }
  }, [page, action, appliedSearch]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  // قائمة الإجراءات من القيم المعروفة (تُبني مرة)
  const actions = useMemo(() => Object.keys(AUDIT_ACTION_LABELS), []);

  const exportCsv = () => {
    const header = ['الرقم', 'المستخدم', 'الوقت', 'الإجراء', 'الكيان', 'التفاصيل', 'IP'];
    const body = rows.map((e) => [
      e.id,
      e.actorName,
      e.timeLabel,
      AUDIT_ACTION_LABELS[e.action] ?? e.action,
      e.entity,
      `"${e.detail.split('"').join('""')}"`,
      e.ip,
    ]);
    const csv = '\uFEFF' + [header, ...body].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: ColumnsType<AuditEntry> = [
    { title: 'الوقت', dataIndex: 'timeLabel', key: 'time', width: 130,
      render: (v: string) => <span className="financial-numbers" style={{ fontSize: 12 }}>{v}</span> },
    { title: 'المستخدم', dataIndex: 'actorName', key: 'actor', width: 120 },
    {
      title: 'الإجراء',
      dataIndex: 'action',
      key: 'action',
      width: 140,
      render: (a: string) => {
        const color =
          a === 'LOGIN_FAILED' || a === 'LOGIN_BLOCKED_DISABLED'
            ? 'error'
            : a === 'USER_DEACTIVATE' || a === 'USER_FORCE_PASSWORD_CHANGE'
              ? 'warning'
              : a === 'LOGIN' || a === 'LOGOUT'
                ? 'default'
                : 'processing';
        return <Tag color={color}>{AUDIT_ACTION_LABELS[a] ?? a}</Tag>;
      },
    },
    { title: 'الكيان', dataIndex: 'entity', key: 'entity', width: 170 },
    { title: 'التفاصيل', dataIndex: 'detail', ellipsis: true },
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 120,
      render: (v: string) => <span dir="ltr" style={{ fontSize: 11 }}>{v}</span> },
  ];

  return (
    <div className="tab-block">
      <AlertNote />
      <Row gutter={[12, 12]} role="search" aria-label="فلترة سجل التدقيق">
        <Col xs={24} sm={12} md={9}>
          <Input.Search
            placeholder="بحث: كيان، إجراء…"
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(v) => {
              setPage(1);
              setAppliedSearch(v);
            }}
            aria-label="بحث في السجل"
          />
        </Col>
        <Col xs={12} md={7}>
          <Select<string | 'all'> value={action} onChange={(v) => { setPage(1); setAction(v); }} style={{ width: '100%' }}
            aria-label="فلترة بالإجراء"
            options={[{ value: 'all', label: 'كل الإجراءات' }, ...actions.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] ?? a }))]} />
        </Col>
        <Col xs={12} md={4}>
          <Tooltip title="تحديث من الخادم">
            <Button block icon={<ReloadOutlined aria-hidden="true" />} onClick={fetchPage}>
              تحديث
            </Button>
          </Tooltip>
        </Col>
        <Col xs={24} md={4}>
          <Tooltip title="تصدير الصفحة الحالية — CSV بترميز عربي سليم">
            <Button block icon={<DownloadOutlined aria-hidden="true" />} onClick={exportCsv}>
              CSV
            </Button>
          </Tooltip>
        </Col>
      </Row>

      <Table<AuditEntry>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={rows}
        loading={loading}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          onChange: (p) => setPage(p),
        }}
        locale={{ emptyText: <Typography.Text type="secondary">لا سجلات مطابقة للفلاتر</Typography.Text> }}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        الإجمالي من الخادم: <strong className="financial-numbers">{total}</strong> سجل — السجل
        إلحاق فقط: لا يوجد أي زر تعديل أو حذف هنا، ولن يوجد (FR-7.2).
      </Typography.Text>
    </div>
  );
}

function AlertNote() {
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      يوثَّق هنا: كل دخول وفشل دخول، اعتماد كشف، ربط/فك ربط، تحديث فروق، إغلاق/إعادة فتح جلسة،
      تصدير تقرير، تعديل مستخدمين وإعدادات، تشغيل نسخة.
    </Typography.Text>
  );
}
