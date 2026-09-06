import { ArrowLeftOutlined, ArrowRightOutlined, CheckCircleFilled, PlayCircleFilled } from '@ant-design/icons';
import { App, Alert, Button, Card, Descriptions, Space, Steps, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CurrencyBadge } from '@/shared/components/CurrencyBadge';
import { listPartners } from '@/features/partners/partnersApi';
import { createSession } from '@/features/sessions/sessionsClient';
import type { CommittedStatementInfo, CurrencyCode, Partner, StatementSide } from '@/shared/types';
import { StepCreateSession, DEFAULT_PERIOD } from './StepCreateSession';
import type { SessionDraft } from './StepCreateSession';
import { StatementUploadStep } from './StatementUploadStep';
import { formatMoney } from './statementValidation';

/**
 * معالج جلسة مطابقة جديدة — وثيقة التصميم §4:
 * 1 إنشاء الجلسة ← 2 كشفنا ← 3 كشف المورد ← 4 المراجعة والتشغيل.
 * لا يُسمح بالخطوة 4 قبل اعتماد الكشفين (FR-3.3/3.4) — الاعتماد حقيقي عبر الخادم.
 * الموردون حقيقيون (Module 2)؛ قائمة الجلسات القائمة ما زالت عرضية حتى Module 4.
 */

export function NewSessionWizardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { message } = App.useApp();

  const [current, setCurrent] = useState(0);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [draft, setDraft] = useState<SessionDraft>({
    period: DEFAULT_PERIOD,
    openingTouched: false,
    openingTheirs: null,
    carried: null,
    partner: searchParams.get('partner') ?? undefined,
    currency: (searchParams.get('currency') as CurrencyCode | null) ?? undefined,
  });
  const [ourStmt, setOurStmt] = useState<CommittedStatementInfo | null>(null);
  const [theirStmt, setTheirStmt] = useState<CommittedStatementInfo | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [conflict, setConflict] = useState<{ id: number } | null>(null);

  // مورّدون حقيقيون من الخادم — القائمة معتمدة عند فتح المعالج
  useEffect(() => {
    listPartners().then(setPartners).catch(() => setPartners([]));
  }, []);

  const periodLabel = draft.period?.format('YYYY-MM') ?? '';

  // حساب المورد المحدد = الطرف + العملة (Q11: لكل عملة حساب/كشف مستقل)
  const selectedAccount = useMemo(() => {
    const partner = partners.find((p) => p.nameAr === draft.partner);
    return partner?.accounts.find((a) => a.currency === draft.currency) ?? null;
  }, [partners, draft.partner, draft.currency]);
  const accountId = selectedAccount?.accountId ?? null;

  const step0Valid = Boolean(draft.partner && draft.currency && draft.period);

  /** الخطوة 0 → 1: إنشاء الجلسة على الخادم (409 = تعارض جلسة مفتوحة) */
  const goNext = () => {
    if (current === 0 && sessionId === null) {
      if (!accountId) return;
      if (draft.carried && draft.openingTouched && (draft.openingReason ?? '').trim().length < 5) {
        message.warning('سبب تعديل الرصيد المرحَّل إجباري (5 أحرف على الأقل) — قاعدة التوثيق الكامل');
        return;
      }
      setCreating(true);
      createSession({
        accountId,
        periodLabel,
        openingBalance: draft.opening ?? null,
        openingTheirs: draft.openingTheirs ?? null,
        carriedFromSessionId: draft.carried?.fromSessionId ?? null,
        openingAdjustReason: draft.carried && draft.openingTouched ? draft.openingReason?.trim() || null : null,
      })
        .then(({ session }) => {
          setSessionId(session.id);
          setCreating(false);
          message.success(`أُنشئت جلسة #${session.id} — أكمل رفع الكشفين`);
          setCurrent(1);
        })
        .catch((e: { code?: string; messageAr?: string; message?: string }) => {
          setCreating(false);
          const m = e?.messageAr ?? e?.message ?? 'فشل إنشاء الجلسة';
          const idMatch = /#(\d+)/.exec(m);
          if (e?.code === 'SESSION_EXISTS' && idMatch) {
            setConflict({ id: Number(idMatch[1]) });
            message.warning(m);
          } else {
            message.error(m);
          }
        });
      return;
    }
    setCurrent((c) => Math.min(c + 1, 3));
  };

  const runMatching = () => {
    if (sessionId) navigate(`/sessions/${sessionId}`);
  };

  const stepItems = [
    { title: 'إنشاء الجلسة' },
    { title: 'كشفنا (نظامنا المحاسبي)' },
    { title: 'كشف المورد' },
    { title: 'المراجعة والتشغيل' },
  ];

  return (
    <section aria-label="معالج جلسة مطابقة جديدة" className="wizard-page">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        جلسة مطابقة جديدة
      </Typography.Title>

      <Steps current={current} items={stepItems} size="small" className="wizard-steps" />

      <Card className="wizard-card">
        {current === 0 && (
          <StepCreateSession
            draft={draft}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            conflict={conflict}
            onGoToExisting={() => navigate('/sessions')}
            partners={partners}
          />
        )}

        {current === 1 && (
          <StatementUploadStep
            side={'ours' as StatementSide}
            accountId={accountId}
            sessionId={sessionId}
            completed={Boolean(ourStmt)}
            onCommitted={(info) => setOurStmt(info)}
          />
        )}

        {current === 2 && (
          <StatementUploadStep
            side={'theirs' as StatementSide}
            accountId={accountId}
            sessionId={sessionId}
            completed={Boolean(theirStmt)}
            onCommitted={(info) => setTheirStmt(info)}
          />
        )}

        {current === 3 && (
          <div className="wizard-summary">
            <Alert
              type="success"
              showIcon
              icon={<CheckCircleFilled />}
              message="الجلسة جاهزة — راجع الملخص ثم شغّل المطابقة"
              style={{ marginBottom: 16 }}
            />
            <Descriptions bordered column={1} size="small">
              <Descriptions.Item label="المورد">{draft.partner}</Descriptions.Item>
              <Descriptions.Item label="العملة">
                {draft.currency && <CurrencyBadge currency={draft.currency as CurrencyCode} />}
              </Descriptions.Item>
              <Descriptions.Item label="الفترة">
                <span className="financial-numbers">{periodLabel}</span>
              </Descriptions.Item>
              <Descriptions.Item label="الرصيد المرحّل">
                <span className="financial-numbers">
                  {draft.opening != null ? formatMoney(draft.opening) : '—'} دائن
                </span>
                {draft.openingTouched && draft.openingReason?.trim() && (
                  <Typography.Text type="secondary"> — سبب التعديل: {draft.openingReason}</Typography.Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="كشفنا">
                {ourStmt ? (
                  <>
                    {ourStmt.fileName} · {ourStmt.lines.length} بنداً · الختامي{' '}
                    <span className="financial-numbers">
                      {formatMoney(ourStmt.parsed.announcedClosing ?? 0)}
                    </span>
                  </>
                ) : (
                  'لم يُعتمد بعد'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="كشف المورد">
                {theirStmt ? (
                  <>
                    {theirStmt.fileName} · {theirStmt.lines.length} بنداً · الختامي{' '}
                    <span className="financial-numbers">
                      {formatMoney(theirStmt.parsed.announcedClosing ?? 0)}
                    </span>
                  </>
                ) : (
                  'لم يُعتمد بعد'
                )}
              </Descriptions.Item>
            </Descriptions>
            <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
              ملاحظة: شاشة عمل المطابقة (الربط والاقتراحات والفروق) هي الخطوة التالية في خطة
              التنفيذ المعتمدة.
            </Typography.Paragraph>
          </div>
        )}

        <div className="wizard-footer">
          <Space>
            <Button
              icon={<ArrowRightOutlined aria-hidden="true" />}
              disabled={current === 0}
              onClick={() => setCurrent((c) => c - 1)}
            >
              السابق
            </Button>

            {current < 3 ? (
              <Button
                type="primary"
                disabled={current === 0 ? !step0Valid : current === 1 ? !ourStmt : !theirStmt}
                loading={current === 0 && creating}
                onClick={goNext}
                icon={<ArrowLeftOutlined aria-hidden="true" />}
                iconPosition="end"
              >
                {current === 0 ? 'إنشاء الجلسة والتالي' : 'التالي'}
              </Button>
            ) : (
              <Button
                type="primary"
                size="large"
                icon={<PlayCircleFilled aria-hidden="true" />}
                onClick={runMatching}
                disabled={!ourStmt || !theirStmt}
              >
                تشغيل المطابقة وفتح شاشة العمل
              </Button>
            )}
          </Space>
        </div>
      </Card>
    </section>
  );
}
