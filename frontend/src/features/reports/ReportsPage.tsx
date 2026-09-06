import { FilePdfOutlined, FileExcelOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Checkbox,
  Descriptions,
  Empty,
  Radio,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Tree,
  Typography,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CurrencyBadge } from '@/shared/components/CurrencyBadge';
import { SessionStatusTag } from '@/shared/components/StatusTags';
import { listPartners } from '@/features/partners/partnersApi';
import { getCompany } from '@/features/settings/settingsClient';
import type { CompanySettings } from '@/features/settings/settingsClient';
import { listSessions } from '@/features/sessions/sessionsClient';
import type { SessionListItem } from '@/features/sessions/sessionsClient';
import {
  exportSessionExcel,
  exportSessionPdf,
  fetchSessionReport,
} from './reportsClient';
import type { SessionReport } from './reportsClient';
import { ReportPaper } from './ReportPaper';

/**
 * التقارير والأرشيف — حقيقيان (Module 6):
 * تقرير جلسة من بيانات الخادم (أرصدة من البنود + نسبة المطابقة + الفروق بأسبابها)
 * بترويسة شركة من الإعدادات، وأرشيف شجري طرف←عملة←سنة من الجلسات الفعلية.
 * الطباعة من المتصفح (تعمل الآن) — التصدير الخلفي المنسق مؤجل معلوماً.
 */

type ReportMode = 'report' | 'letter';

export function ReportsPage() {
  const [mode, setMode] = useState<ReportMode>('report');
  const [sections, setSections] = useState({ summary: true, discrepancies: true, signatures: true });

  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [report, setReport] = useState<SessionReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('report');
  const [archiveSelected, setArchiveSelected] = useState<SessionListItem | null>(null);

  const load = useCallback(() => {
    listSessions()
      .then((rows) => {
        setSessions(rows);
        setSessionId((prev) => prev ?? rows[0]?.id ?? null);
      })
      .catch(() => undefined);
    getCompany().then(setCompany).catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  // تركيب التقرير عند تغيير الجلسة — من نداءي الخادم الحقيقيين
  useEffect(() => {
    if (!sessionId) {
      setReport(null);
      return;
    }
    setReportLoading(true);
    const sessionRow = sessions.find((s) => s.id === sessionId);
    listPartners()
      .then((partners) => {
        const partner = partners.find((p) => p.id === sessionRow?.partner.id);
        const account = partner?.accounts.find((a) => a.currency === sessionRow?.currencyCode);
        return fetchSessionReport(sessionId, {
          ledgerCode: account?.ledgerCode ?? '—',
          partnerNameEn: partner?.nameEn ?? undefined,
          company,
        });
      })
      .then(setReport)
      .catch(() => setReport(null))
      .finally(() => setReportLoading(false));
  }, [sessionId, sessions, company]);

  const sessionOptions = sessions.map((s) => ({
    value: s.id,
    label: `#${s.id} — ${s.partner.nameAr} · ${s.periodLabel} · ${s.status === 'closed' ? 'مغلقة' : s.status === 'reopened' ? 'معاد فتحها' : 'قيد العمل'}`,
  }));

  // ===== شجرة الأرشيف من الجلسات الحقيقية =====
  const treeData: DataNode[] = useMemo(() => {
    const byPartner = new Map<string, SessionListItem[]>();
    sessions.forEach((s) => {
      byPartner.set(s.partner.nameAr, [...(byPartner.get(s.partner.nameAr) ?? []), s]);
    });
    return [...byPartner.entries()].map(([partnerName, rows]) => {
      const byCurrency = new Map<string, SessionListItem[]>();
      rows.forEach((s) => {
        byCurrency.set(s.currencyCode, [...(byCurrency.get(s.currencyCode) ?? []), s]);
      });
      return {
        title: <strong>{partnerName}</strong>,
        key: `p:${partnerName}`,
        selectable: false,
        children: [...byCurrency.entries()].map(([currency, curRows]) => {
          const years = new Map<string, SessionListItem[]>();
          curRows.forEach((s) => {
            years.set(s.periodLabel.slice(0, 4), [...(years.get(s.periodLabel.slice(0, 4)) ?? []), s]);
          });
          return {
            title: <CurrencyBadge currency={currency as 'YER' | 'USD' | 'SAR'} />,
            key: `c:${partnerName}:${currency}`,
            selectable: false,
            children: [...years.entries()].map(([year, yearRows]) => ({
              title: <span className="financial-numbers">{year}</span>,
              key: `y:${partnerName}:${currency}:${year}`,
              selectable: false,
              children: yearRows.map((s) => ({
                title: (
                  <span className="archive-leaf financial-numbers">
                    {s.periodLabel}
                    {s.progress.ours.leftoverCount + s.progress.theirs.leftoverCount > 0 && (
                      <Tag color="warning" style={{ marginInlineStart: 6, fontSize: 10 }}>
                        {s.progress.ours.leftoverCount + s.progress.theirs.leftoverCount} متبقٍ
                      </Tag>
                    )}
                  </span>
                ),
                key: `s:${s.id}`,
              })),
            })),
          };
        }),
      };
    });
  }, [sessions]);

  const openInReportTab = (id: number) => {
    setSessionId(id);
    setActiveTab('report');
  };

  const reportTab = reportLoading ? (
    <div style={{ padding: 64, textAlign: 'center' }} aria-busy="true">
      <Spin size="large" />
    </div>
  ) : report ? (
    <div className="reports-layout">
      <div className="reports-controls">
        <Card size="small" title="خيارات التقرير">
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                الجلسة
              </Typography.Text>
              <Select<number>
                value={sessionId ?? undefined}
                onChange={setSessionId}
                style={{ width: '100%' }}
                aria-label="اختيار الجلسة"
                options={sessionOptions}
                showSearch
                optionFilterProp="label"
              />
            </div>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                نوع المستند
              </Typography.Text>
              <Radio.Group
                value={mode}
                onChange={(e) => setMode(e.target.value as ReportMode)}
                buttonStyle="solid"
                aria-label="نوع المستند"
              >
                <Radio.Button value="report">التقرير الكامل</Radio.Button>
                <Radio.Button value="letter">خطاب اعتماد الرصيد</Radio.Button>
              </Radio.Group>
            </div>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>
                أقسام التقرير
              </Typography.Text>
              <Checkbox
                checked={sections.summary}
                onChange={(e) => setSections((s) => ({ ...s, summary: e.target.checked }))}
                disabled={mode === 'letter'}
              >
                ملخص الأرصدة والمطابقة
              </Checkbox>
              <Checkbox
                checked={sections.discrepancies}
                onChange={(e) => setSections((s) => ({ ...s, discrepancies: e.target.checked }))}
                disabled={mode === 'letter'}
              >
                جدول الفروق وأسبابها
              </Checkbox>
              <Checkbox
                checked={sections.signatures}
                onChange={(e) => setSections((s) => ({ ...s, signatures: e.target.checked }))}
              >
                خانات التوقيعات
              </Checkbox>
            </div>

            <Tooltip title="يُطبع ورقة التقرير فقط — جرّب «حفظ كـ PDF» من نافذة الطباعة">
              <Button type="primary" icon={<PrinterOutlined aria-hidden="true" />} block onClick={() => window.print()}>
                طباعة / حفظ PDF من المتصفح
              </Button>
            </Tooltip>
            <Space style={{ width: '100%' }} size={8}>
              <Tooltip title="PDF خلفي منسق يُبنى في الخادم بخط عربي مضمّن — يفتح في تبويب جديد">
                <Button
                  icon={<FilePdfOutlined aria-hidden="true" />}
                  block
                  disabled={!sessionId}
                  onClick={() => window.open(exportSessionPdf(sessionId!), '_blank')}
                >
                  PDF خلفي
                </Button>
              </Tooltip>
              <Tooltip title="ملف Excel بورقتي التسوية والفروق مع ملاحظات الفريق">
                <Button
                  icon={<FileExcelOutlined aria-hidden="true" />}
                  block
                  disabled={!sessionId}
                  onClick={() => window.open(exportSessionExcel(sessionId!), '_blank')}
                >
                  Excel
                </Button>
              </Tooltip>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {report.isDraft
                ? '⚠ الجلسة غير مغلقة — التقرير بعلامة مائية «مسودة»، أغلق الجلسة لإصدار النسخة النهائية.'
                : 'تقرير نهائي من جلسة مغلقة — أرقامه لقطة الإغلاق المحفوظة.'}
            </Typography.Text>
          </Space>
        </Card>
      </div>

      <div className="reports-preview">
        <ReportPaper report={report} mode={mode} sections={sections} />
      </div>
    </div>
  ) : (
    <Empty
      description={
        sessions.length === 0
          ? 'لا جلسات بعد — أنشئ جلسة مطابقة وأكملها ليصدر تقريرها هنا'
          : 'تعذر تركيب التقرير — أعد المحاولة'
      }
      style={{ padding: 48 }}
    />
  );

  const archiveTab = (
    <div className="reports-layout">
      <Card size="small" title="أرشيف الحسابات — طرف ← عملة ← سنة" className="archive-tree-card">
        <Space style={{ marginBottom: 8 }}>
          <Button size="small" icon={<ReloadOutlined aria-hidden="true" />} onClick={load} aria-label="تحديث الأرشيف" />
        </Space>
        <Tree
          treeData={treeData}
          selectable
          onSelect={(keys) => {
            const key = String(keys[0] ?? '');
            if (key.startsWith('s:')) {
              const id = Number(key.slice(2));
              setArchiveSelected(sessions.find((s) => s.id === id) ?? null);
            }
          }}
          aria-label="شجرة الأرشيف التاريخي"
        />
        {sessions.length === 0 && <Typography.Text type="secondary">لا جلسات مؤرشفة بعد</Typography.Text>}
      </Card>

      <Card size="small" title="تفاصيل الجلسة المختارة" className="archive-details-card">
        {archiveSelected ? (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Descriptions size="small" bordered column={1}>
              <Descriptions.Item label="الجلسة">
                <span className="financial-numbers">#{archiveSelected.id}</span> —{' '}
                <span className="financial-numbers">{archiveSelected.periodLabel}</span>
              </Descriptions.Item>
              <Descriptions.Item label="العملة">
                <CurrencyBadge currency={archiveSelected.currencyCode} />
              </Descriptions.Item>
              <Descriptions.Item label="الحالة">
                <SessionStatusTag status={archiveSelected.status} />
              </Descriptions.Item>
              <Descriptions.Item label="نسبة المطابقة المؤكدة">
                <span className="financial-numbers">
                  {archiveSelected.progress.theirs.lineCount + archiveSelected.progress.ours.lineCount > 0
                    ? `${archiveSelected.progress.matchRatePct.toFixed(1)}%`
                    : '—'}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="بنود متبقية">
                <span className="financial-numbers">
                  {archiveSelected.progress.ours.leftoverCount + archiveSelected.progress.theirs.leftoverCount}
                </span>
              </Descriptions.Item>
            </Descriptions>

            <Button
              size="small"
              type="primary"
              ghost
              icon={<PrinterOutlined aria-hidden="true" />}
              onClick={() => openInReportTab(archiveSelected.id)}
            >
              عرض تقريرها في تبويب التقرير
            </Button>
          </Space>
        ) : (
          <Empty description="اختر جلسة من الشجرة لعرض تفاصيلها" />
        )}
      </Card>
    </div>
  );

  return (
    <section aria-label="التقارير والأرشيف" className="reports-page">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        التقارير والأرشيف
      </Typography.Title>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        defaultActiveKey="report"
        items={[
          { key: 'report', label: 'تقرير جلسة', children: reportTab },
          { key: 'archive', label: 'الأرشيف التاريخي', children: archiveTab },
        ]}
      />
    </section>
  );
}
