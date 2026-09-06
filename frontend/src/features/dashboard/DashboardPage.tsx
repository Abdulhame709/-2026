import {
  AlertOutlined,
  FundOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Card, Empty, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CurrencyBadge } from '@/shared/components/CurrencyBadge';
import { DiscrepancyStatusTag, SessionStatusTag } from '@/shared/components/StatusTags';
import { KpiCard } from '@/shared/components/KpiCard';
import { listDiscrepancies, ageInDays } from '@/features/discrepancies/discrepanciesClient';
import type { DiscrepancyFull } from '@/features/discrepancies/discrepanciesClient';
import { listSessions } from '@/features/sessions/sessionsClient';
import type { SessionListItem } from '@/features/sessions/sessionsClient';
import type { SessionStatus, CurrencyCode } from '@/shared/types';
import { MatchTrendChart } from './MatchTrendChart';

/**
 * لوحة المؤشرات — حقيقية (Module 6): «ماذا ينتظرني اليوم؟»
 * 4 مؤشرات محسوبة من الجلسات والفروق الفعلية + جلسات تحتاج انتباهاً
 * + تطور نسبة المطابقة من الجلسات المغلقة + الفروق المتأخرة.
 */

interface SessionAttentionRow {
  id: number;
  partnerName: string;
  currency: CurrencyCode;
  periodLabel: string;
  status: SessionStatus;
  openDiscrepancies: number;
  openDiscrepancyValue: number;
  lastActivityLabel: string;
}

export function DashboardPage() {
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [discrepancies, setDiscrepancies] = useState<DiscrepancyFull[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([listSessions(), listDiscrepancies()])
      .then(([s, d]) => {
        setSessions(s);
        setDiscrepancies(d);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const openSessions = useMemo(
    () => sessions.filter((s) => s.status !== 'closed'),
    [sessions],
  );
  const openDiscs = useMemo(
    () => discrepancies.filter((d) => d.status === 'new' || d.status === 'in_progress'),
    [discrepancies],
  );
  const overdueDiscs = useMemo(
    () => openDiscs.filter((d) => ageInDays(d.createdAt) >= 30),
    [openDiscs],
  );

  // أحدث جلسة عليها بنود = مؤشر الشهر الحالي
  const latest = useMemo(() => {
    const withLines = sessions.filter((s) => s.progress.ours.lineCount + s.progress.theirs.lineCount > 0);
    return withLines.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
  }, [sessions]);

  const attentionRows: SessionAttentionRow[] = useMemo(
    () =>
      openSessions
        .map((s) => ({
          id: s.id,
          partnerName: s.partner.nameAr,
          currency: s.currencyCode,
          periodLabel: s.periodLabel,
          status: s.status,
          openDiscrepancies: s.progress.ours.leftoverCount + s.progress.theirs.leftoverCount,
          openDiscrepancyValue: s.progress.ours.leftover + s.progress.theirs.leftover,
          lastActivityLabel: s.createdAt.slice(0, 10),
        }))
        .sort((a, b) => b.openDiscrepancyValue - a.openDiscrepancyValue)
        .slice(0, 5),
    [openSessions],
  );

  const trend = useMemo(
    () =>
      sessions
        .filter((s) => s.status === 'closed' && s.progress.theirs.lineCount + s.progress.ours.lineCount > 0)
        .sort((a, b) => (a.periodLabel > b.periodLabel ? 1 : -1))
        .slice(-6)
        .map((s) => ({ month: s.periodLabel, rate: Math.round(s.progress.matchRatePct) })),
    [sessions],
  );

  const openSession = (row: SessionAttentionRow) => {
    navigate(`/sessions/${row.id}`);
  };

  const sessionColumns: ColumnsType<SessionAttentionRow> = [
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
      width: 90,
      render: (c: SessionAttentionRow['currency']) => <CurrencyBadge currency={c} />,
    },
    { title: 'الفترة', dataIndex: 'periodLabel', key: 'period', width: 100 },
    {
      title: 'الحالة',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (s: SessionAttentionRow['status']) => <SessionStatusTag status={s} />,
    },
    {
      title: 'بنود متبقية',
      key: 'disc',
      width: 150,
      render: (_, row) =>
        row.openDiscrepancies > 0 ? (
          <span className="financial-numbers">
            {row.openDiscrepancies} · {row.openDiscrepancyValue.toLocaleString('en-US')}
          </span>
        ) : (
          <Typography.Text type="secondary">لا يوجد</Typography.Text>
        ),
    },
    {
      title: 'أُنشئت',
      dataIndex: 'lastActivityLabel',
      key: 'last',
      width: 120,
      render: (label: string) => (
        <Typography.Text type="secondary" className="financial-numbers">
          {label}
        </Typography.Text>
      ),
    },
  ];

  const oldDiscColumns: ColumnsType<DiscrepancyFull> = [
    {
      title: 'الطرف',
      dataIndex: 'partnerName',
      key: 'partner',
      render: (name: string) => <strong>{name}</strong>,
    },
    { title: 'الفترة', dataIndex: 'periodLabel', key: 'period', width: 95 },
    { title: 'الوصف', dataIndex: 'lineDescription', key: 'summary', ellipsis: true },
    {
      title: 'المبلغ',
      dataIndex: 'diffAmount',
      key: 'diff',
      width: 130,
      render: (v: number | null, row) => (
        <span className="financial-numbers">
          {v != null ? v.toLocaleString('en-US') : '—'} <CurrencyBadge currency={row.currencyCode} />
        </span>
      ),
    },
    {
      title: 'العمر',
      key: 'age',
      width: 95,
      render: (_, row) => {
        const days = ageInDays(row.createdAt);
        return (
          <span
            className="financial-numbers"
            style={{ color: days >= 30 ? 'var(--color-error)' : 'var(--color-warning)', fontWeight: 600 }}
          >
            {days} يوماً
          </span>
        );
      },
    },
    {
      title: 'المسؤول',
      dataIndex: 'assigneeName',
      key: 'assignee',
      width: 150,
      render: (name: string | null) =>
        name ? (
          <span className="assignee-cell">
            <Avatar size={22} style={{ backgroundColor: 'var(--color-primary)', fontSize: 11 }}>
              {name.charAt(0)}
            </Avatar>
            {name}
          </span>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'الحالة',
      dataIndex: 'status',
      key: 'status',
      width: 115,
      render: (s: DiscrepancyFull['status']) => <DiscrepancyStatusTag status={s} />,
    },
  ];

  return (
    <section aria-label="لوحة المؤشرات" className="dashboard-page">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        لوحة المؤشرات
      </Typography.Title>

      <div className="kpi-grid">
        <KpiCard
          title="جلسات مفتوحة"
          value={String(openSessions.length)}
          sub={openSessions.length ? 'أكمل المطابقة والإغلاق' : 'لا جلسات معلقة ✓'}
          onClick={() => navigate('/sessions')}
        />
        <KpiCard
          title="فروق مفتوحة"
          value={String(openDiscs.length)}
          sub={
            openDiscs.length
              ? `قيمة متبقية ${Math.round(openDiscs.reduce((s, d) => s + (d.diffAmount ?? 0), 0)).toLocaleString('en-US')}`
              : 'كل الفروق محسومة ✓'
          }
          tone={openDiscs.length ? 'warning' : 'success'}
          onClick={() => navigate('/discrepancies')}
        />
        <KpiCard
          title={latest ? `نسبة المطابقة — ${latest.periodLabel}` : 'نسبة المطابقة'}
          value={latest ? `${Math.round(latest.progress.matchRatePct)}%` : '—'}
          sub={latest ? latest.partner.nameAr : 'لا جلسات مكتملة بعد'}
          tone="success"
        />
        <KpiCard
          title="فروق متأخرة > 30 يوماً"
          value={String(overdueDiscs.length)}
          sub={overdueDiscs.length ? 'تتطلب متابعة عاجلة مع الموردين' : 'لا فروق متأخرة ✓'}
          tone={overdueDiscs.length ? 'danger' : 'success'}
          onClick={() => navigate('/discrepancies')}
        />
      </div>

      <div className="dash-grid">
        <Card
          title={
            <span>
              <SyncOutlined aria-hidden="true" /> جلسات تحتاج انتباهاً
            </span>
          }
          extra={
            <Button type="link" size="small" onClick={() => navigate('/sessions')}>
              عرض الكل
            </Button>
          }
          styles={{ body: { paddingInline: 0, paddingBlock: 0 } }}
        >
          <Table<SessionAttentionRow>
            rowKey="id"
            size="small"
            columns={sessionColumns}
            dataSource={attentionRows}
            loading={!loaded}
            pagination={false}
            locale={{ emptyText: <Empty description="لا جلسات مفتوحة — كل شيء مقفل وسليم ✓" /> }}
            rowClassName="clickable-row"
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
              'aria-label': `فتح جلسة ${row.partnerName} فترة ${row.periodLabel}`,
            })}
          />
        </Card>

        <Card
          title={
            <span>
              <FundOutlined aria-hidden="true" /> تطور نسبة المطابقة
            </span>
          }
          styles={{ body: { paddingBlock: 16 } }}
        >
          {trend.length > 0 ? (
            <>
              <MatchTrendChart data={trend} />
              <Typography.Paragraph
                type="secondary"
                style={{ textAlign: 'center', marginBottom: 0, fontSize: 12 }}
              >
                الجلسات المغلقة الأخيرة — من الأقدم (يميناً) إلى الأحدث (يساراً)
              </Typography.Paragraph>
            </>
          ) : (
            <Empty description="تظهر عند إغلاق أول جلسة مطابقة" />
          )}
        </Card>
      </div>

      <Card
        title={
          <span>
            <AlertOutlined aria-hidden="true" /> فروق متجاوزة 30 يوماً — الأقدم أولاً
          </span>
        }
        extra={
          <Button type="link" size="small" onClick={() => navigate('/discrepancies')}>
            كل الفروق
          </Button>
        }
        styles={{ body: { paddingInline: 0, paddingBlock: 0 } }}
      >
        <Table<DiscrepancyFull>
          rowKey="id"
          size="small"
          columns={oldDiscColumns}
          dataSource={[...overdueDiscs].sort((a, b) => ageInDays(b.createdAt) - ageInDays(a.createdAt))}
          loading={!loaded}
          pagination={false}
          locale={{ emptyText: <Empty description="لا فروق متأخرة — أحسن حال ✓" /> }}
        />
      </Card>
    </section>
  );
}
