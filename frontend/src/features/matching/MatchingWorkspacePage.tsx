import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  LinkOutlined,
  LockOutlined,
  PlayCircleOutlined,
  PrinterOutlined,
  ReloadOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Input,
  InputNumber,
  Modal,
  Progress,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CurrencyBadge } from '@/shared/components/CurrencyBadge';
import { SessionStatusTag } from '@/shared/components/StatusTags';
import { useAuth } from '@/app/AuthContext';
import { formatMoney } from '@/features/statements/import/statementValidation';
import {
  RULE_LABELS,
  closeSession,
  confirmGroup,
  getSessionDetail,
  manualGroup,
  rejectGroup,
  reopenSession,
  suggestMatches,
  unlinkGroup,
} from '@/features/sessions/sessionsClient';
import type {
  CloseDiscrepancy,
  MatchGroup,
  MatchRule,
  SessionDetail,
  WsLine,
} from '@/features/sessions/sessionsClient';

/**
 * شاشة عمل المطابقة — الحقيقية (Module 4):
 * عمودان متقابلان لبنود الكشفين المتبقية، سحب وإفلات لبدء ربط يدوي (بناة حصص
 * للتوزيع الجزئي مع توازن حي Q11)، بطاقات اقتراحات المحرك (قبول/رفض) والمؤكد (فك)،
 * شريط صحة بمجاميع كل جهة، وإغلاق بلقطة ملخص + ورقة تسوية قابلة للطباعة.
 */

interface DraftItem {
  lineId: number;
  side: 'ours' | 'theirs';
  /** حصة البند بالمطلق (تُحوَّل لإشارة البند عند الحفظ) */
  portion: number;
}

const ERR_SIDE_LABEL: Record<'ours' | 'theirs', string> = { ours: 'كشفنا', theirs: 'كشفهم' };

export function MatchingWorkspacePage() {
  const params = useParams();
  const navigate = useNavigate();
  const sessionId = Number(params.id);
  const { message } = App.useApp();
  const { hasRole } = useAuth();
  const canReconcile = hasRole('admin', 'reconciler');

  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ items: DraftItem[]; note: string } | null>(null);
  const [dragOver, setDragOver] = useState<'ours' | 'theirs' | null>(null);
  const [settlementOpen, setSettlementOpen] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    getSessionDetail(sessionId)
      .then(setDetail)
      .catch((e: { messageAr?: string; message?: string }) => message.error(e?.messageAr ?? 'تعذر جلب الجلسة'))
      .finally(() => setLoading(false));
  }, [sessionId, message]);

  useEffect(() => {
    reload();
  }, [reload]);

  // النظام يعمل لا ينتظر: جلسة مفتوحة بكشفين كاملين وبلا روابط نشطة → المحرك يبحث فوراً.
  // ملاحظة: الاعتماد الطبيعي يشغّله على الخادم مباشرة — هذا احتياط للجلسات القديمة المعلقة.
  const autoRanFor = useRef<number | null>(null);
  useEffect(() => {
    if (!detail || !canReconcile) return;
    if (detail.session.status === 'closed') return;
    if (!detail.ourStatement || !detail.theirStatement) return;
    if (detail.groups.some((g) => g.isActive)) return;
    if (autoRanFor.current === sessionId) return;
    autoRanFor.current = sessionId;
    setBusy(true);
    suggestMatches(sessionId)
      .then((r) => {
        if (r.autoConfirmed + r.suggested > 0) {
          message.success(
            `بحث النظام تلقائياً: أكد ${r.autoConfirmed} مطابقة قطعية${r.suggested > 0 ? ` واقترح ${r.suggested} تحتاج مراجعتك` : ''}`,
          );
        }
        reload();
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  /** فهرس البنود: معرف → (البند + جهته) */
  const lineIndex = useMemo(() => {
    const map = new Map<number, { line: WsLine; side: 'ours' | 'theirs' }>();
    if (!detail) return map;
    for (const l of detail.ourStatement?.lines ?? []) map.set(l.id, { line: l, side: 'ours' });
    for (const l of detail.theirStatement?.lines ?? []) map.set(l.id, { line: l, side: 'theirs' });
    return map;
  }, [detail]);

  const activeGroups = useMemo(
    () => (detail ? detail.groups.filter((g) => g.isActive) : []),
    [detail],
  );
  const suggested = activeGroups.filter((g) => g.status === 'suggested');
  const confirmed = activeGroups.filter((g) => g.status === 'confirmed');

  const open = detail && detail.session.status !== 'closed';

  /** البنود المتبقية (غير المربوطة كلياً) لكل جهة */
  const remainingLines = (side: 'ours' | 'theirs'): WsLine[] => {
    const st = side === 'ours' ? detail?.ourStatement : detail?.theirStatement;
    return (st?.lines ?? []).filter((l) => l.remaining > 0.005);
  };

  // ===== مناورة السحب والإفلات =====
  const onLineDragStart = (e: React.DragEvent, lineId: number, side: 'ours' | 'theirs') => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ lineId, side }));
    e.dataTransfer.effectAllowed = 'link';
  };

  /** إفلات بند على بند مقابل → مسودة ربط ثنائية (تستقبل المزيد بالسحب على اللوحة) */
  const onDropOnLine = (e: React.DragEvent, targetLineId: number, targetSide: 'ours' | 'theirs') => {
    e.preventDefault();
    setDragOver(null);
    if (!canReconcile || !open) return;
    try {
      const { lineId, side } = JSON.parse(e.dataTransfer.getData('text/plain')) as { lineId: number; side: 'ours' | 'theirs' };
      if (side === targetSide) {
        message.warning('الربط بين الجهتين — اسحب البند لعمود الجهة المقابلة');
        return;
      }
      const a = lineIndex.get(lineId);
      const b = lineIndex.get(targetLineId);
      if (!a || !b) return;
      startDraft([a, b]);
    } catch {
      /* سحب غير صالح */
    }
  };

  const onDropOnZone = (e: React.DragEvent, _side: 'ours' | 'theirs') => {
    e.preventDefault();
    setDragOver(null);
    if (!canReconcile || !open) return;
    try {
      const { lineId } = JSON.parse(e.dataTransfer.getData('text/plain')) as { lineId: number };
      const info = lineIndex.get(lineId);
      if (!info) return;
      if (draft) addLineToDraft(info);
      else startDraft([info]);
    } catch {
      /* سحب غير صالح */
    }
  };

  // ===== بناة الربط اليدوي =====
  const startDraft = (entries: Array<{ line: WsLine; side: 'ours' | 'theirs' }>) => {
    const items: DraftItem[] = entries.map(({ line, side: entrySide }) => ({ lineId: line.id, side: entrySide, portion: line.remaining }));
    setDraft({ items, note: '' });
  };

  const addLineToDraft = (entry: { line: WsLine; side: 'ours' | 'theirs' }) => {
    setDraft((d) => {
      if (!d) return d;
      if (d.items.some((i) => i.lineId === entry.line.id)) return d;
      return { ...d, items: [...d.items, { lineId: entry.line.id, side: entry.side, portion: entry.line.remaining }] };
    });
  };

  const draftBalance = useMemo(() => {
    if (!draft) return { ours: 0, theirs: 0, ok: false };
    let ours = 0;
    let theirs = 0;
    for (const it of draft.items) {
      if (it.side === 'ours') ours += it.portion;
      else theirs += it.portion;
    }
    return { ours, theirs, ok: Math.abs(ours - theirs) <= 0.005 };
  }, [draft]);

  const confirmDraft = () => {
    if (!draft || !detail || !draftBalance.ok) return;
    setBusy(true);
    const items = draft.items.map((i) => {
      const info = lineIndex.get(i.lineId)!;
      return { lineId: i.lineId, allocated: Math.sign(info.line.signed) * i.portion };
    });
    manualGroup(detail.session.id, items, draft.note || undefined)
      .then(() => {
        message.success('رُبطت المجموعة يدوياً');
        setDraft(null);
        setBusy(false);
        reload();
      })
      .catch((e: { messageAr?: string; message?: string }) => {
        setBusy(false);
        message.error(e?.messageAr ?? 'فشل الربط اليدوي');
      });
  };

  // ===== أفعال المجموعات =====
  const withBusy = (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    fn()
      .then(() => {
        message.success(okMsg);
        reload();
      })
      .catch((e: { messageAr?: string; message?: string }) => message.error(e?.messageAr ?? 'فشل الإجراء'))
      .finally(() => setBusy(false));
  };

  const runSuggest = () =>
    withBusy(() => suggestMatches(sessionId), 'أعاد النظام البحث — القطعي أكده والملتبس بانتظار مراجعتك');

  const doClose = () => {
    setBusy(true);
    closeSession(sessionId)
      .then(() => {
        message.success('أُغلقت الجلسة — اللقطة محفوظة للتوثيق');
        setBusy(false);
        reload();
        setSettlementOpen(true);
      })
      .catch((e: { messageAr?: string; message?: string }) => {
        setBusy(false);
        message.error(e?.messageAr ?? 'فشل الإغلاق');
      });
  };

  // ===== جداول البنود =====
  const lineColumns = (side: 'ours' | 'theirs'): ColumnsType<WsLine> => [
    {
      title: '#',
      dataIndex: 'lineNo',
      key: 'no',
      width: 36,
      render: (n: number) => <span className="financial-numbers">{n}</span>,
    },
    {
      title: 'التاريخ',
      dataIndex: 'entryDate',
      key: 'date',
      width: 95,
      render: (d: string | null) => <span className="financial-numbers">{d ?? '—'}</span>,
    },
    {
      title: ERR_SIDE_LABEL[side],
      dataIndex: 'description',
      key: 'desc',
      ellipsis: true,
    },
    {
      title: 'المرجع',
      key: 'ref',
      width: 90,
      render: (_, l) => <span className="financial-numbers">{l.ref || l.docNo || '—'}</span>,
    },
    {
      title: 'المبلغ',
      key: 'amt',
      width: 120,
      render: (_, l) => (
        <span className="financial-numbers">
          {formatMoney(Math.abs(l.signed))}
          {l.remaining + 0.005 < Math.abs(l.signed) && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {' '}
              (متبقٍ {formatMoney(l.remaining)})
            </Typography.Text>
          )}
        </span>
      ),
    },
  ];

  const columnBlock = (side: 'ours' | 'theirs') => {
    const lines = remainingLines(side);
    return (
      <div
        className={`ws-column ws-column-${side}${dragOver === side ? ' ws-drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(side);
        }}
        onDragLeave={() => setDragOver((s) => (s === side ? null : s))}
        onDrop={(e) => onDropOnZone(e, side)}
      >
        <div className="ws-column-head">
          <strong>{ERR_SIDE_LABEL[side]}</strong>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            يطابقها النظام آلياً — السحب لإصلاح ما تعجز عنه القواعد فقط
          </Typography.Text>
        </div>
        <Table<WsLine>
          rowKey="id"
          size="small"
          columns={lineColumns(side)}
          dataSource={lines}
          pagination={false}
          loading={loading}
          rowClassName={() => 'ws-line-row'}
          locale={{ emptyText: 'لا بنود متبقية — جهة مكتملة ✓' }}
          onRow={(l) => ({
            draggable: Boolean(canReconcile && open),
            onDragStart: (e: React.DragEvent) => onLineDragStart(e, l.id, side),
            onDragOver: (e: React.DragEvent) => e.preventDefault(),
            onDrop: (e: React.DragEvent) => onDropOnLine(e, l.id, side),
            title: canReconcile && open ? 'اسحب هذا البند لربطه بمقابله' : undefined,
          })}
        />
      </div>
    );
  };

  if (loading && !detail) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }} aria-busy="true">
        <Spin size="large" />
      </div>
    );
  }
  if (!detail) {
    // جلسة محذوفة/غير موجودة — طريق مسود سابقاً (دوّامة)؛ الآن مخرج واضح
    return (
      <Alert
        type="warning"
        showIcon
        message="الجلسة غير موجودة — ربما حُذفت للتو"
        description={
          <Button type="primary" onClick={() => navigate('/sessions')}>
            العودة إلى قائمة الجلسات
          </Button>
        }
      />
    );
  }

  const { session, partner, progress } = detail;
  const summary = session.closeSummary;

  return (
    <section aria-label="شاشة عمل المطابقة" className="ws-page">
      {/* شريط الجلسة */}
      <div className="ws-session-bar">
        <Space wrap size={12}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            جلسة #{session.id} — {partner.nameAr}
          </Typography.Title>
          <CurrencyBadge currency={session.currencyCode} />
          <span className="financial-numbers">{session.periodLabel}</span>
          <SessionStatusTag status={session.status} />
        </Space>
        <Space wrap>
          <Button icon={<ReloadOutlined aria-hidden="true" />} onClick={reload} aria-label="تحديث" />
          {canReconcile && open && (
            <Button
              type="primary"
              ghost
              icon={<PlayCircleOutlined aria-hidden="true" />}
              loading={busy}
              onClick={runSuggest}
            >
              إعادة البحث الآلي
            </Button>
          )}
          {canReconcile && open && (
            <PopconfirmClose onConfirm={doClose} progress={progress} />
          )}
          {session.status === 'closed' && hasRole('admin') && (
            <Button
              icon={<UnlockOutlined aria-hidden="true" />}
              onClick={() => withBusy(() => reopenSession(session.id), 'أُعيد فتح الجلسة')}
            >
              إعادة فتح
            </Button>
          )}
          {session.status === 'closed' && summary && (
            <Button icon={<PrinterOutlined aria-hidden="true" />} onClick={() => setSettlementOpen(true)}>
              ورقة التسوية
            </Button>
          )}
        </Space>
      </div>

      {/* شريط الصحة */}
      <div className="ws-summary" role="status" aria-label="ملخص التقدم">
        <span>
          نسبة التأكيد:{' '}
          <strong className="financial-numbers">{progress.matchRatePct.toFixed(1)}%</strong>
          <Progress
            percent={progress.matchRatePct}
            size="small"
            showInfo={false}
            style={{ width: 120, display: 'inline-block', marginInlineStart: 8 }}
          />
        </span>
        <span>
          كشفنا: مؤكد <strong className="financial-numbers">{formatMoney(progress.ours.matchedConfirmed)}</strong> ·
          مقترح <strong className="financial-numbers">{formatMoney(progress.ours.matchedSuggested)}</strong> · متبقٍ{' '}
          <strong className="financial-numbers">{formatMoney(progress.ours.leftover)}</strong>
        </span>
        <span>
          كشفهم: مؤكد <strong className="financial-numbers">{formatMoney(progress.theirs.matchedConfirmed)}</strong> ·
          مقترح <strong className="financial-numbers">{formatMoney(progress.theirs.matchedSuggested)}</strong> · متبقٍ{' '}
          <strong className="financial-numbers">{formatMoney(progress.theirs.leftover)}</strong>
        </span>
      </div>

      {session.status === 'closed' && (
        <Alert
          type="success"
          showIcon
          icon={<LockOutlined aria-hidden="true" />}
          message="الجلسة مغلقة — مطابقاتها مجمدة"
          description={
            summary ? (
              <Space wrap>
                <span>
                  نسبة التأكيد وقت الإغلاق {summary.matchRatePct}% · فروق متبقية{' '}
                  {summary.discrepancies.length} (تُديرها صفحة الفروق)
                </span>
                <Button size="small" type="link" onClick={() => navigate(`/discrepancies?session=${session.id}`)}>
                  عرض فروق الجلسة
                </Button>
                <Button size="small" type="link" onClick={() => setSettlementOpen(true)}>
                  ورقة التسوية
                </Button>
              </Space>
            ) : undefined
          }
        />
      )}

      {/* بناة الربط اليدوي (مسودة السحب) */}
      {draft && open && canReconcile && (
        <div
          className="ws-draft-builder"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            try {
              const { lineId } = JSON.parse(e.dataTransfer.getData('text/plain')) as { lineId: number };
              const info = lineIndex.get(lineId);
              if (info) addLineToDraft(info);
            } catch {
              /* تجاهل */
            }
          }}
        >
          <div className="ws-draft-head">
            <LinkOutlined aria-hidden="true" />
            <strong>ربط يدوي جديد</strong>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              عدّل حصص التوزيع إن كانت دفعة تغطي عدة بنود — أفلت بنوداً إضافية هنا
            </Typography.Text>
            <Space style={{ marginInlineStart: 'auto' }}>
              <Button icon={<DeleteOutlined aria-hidden="true" />} onClick={() => setDraft(null)}>
                إلغاء
              </Button>
              <Button
                type="primary"
                icon={<CheckOutlined aria-hidden="true" />}
                disabled={!draftBalance.ok || draft.items.length < 2}
                loading={busy}
                onClick={confirmDraft}
              >
                تأكيد الربط
              </Button>
            </Space>
          </div>
          <div className="ws-draft-items">
            {draft.items.map((it) => {
              const info = lineIndex.get(it.lineId);
              if (!info) return null;
              return (
                <div key={it.lineId} className="ws-draft-item">
                  <Tag color={it.side === 'ours' ? 'purple' : 'magenta'}>{ERR_SIDE_LABEL[it.side]}</Tag>
                  <span className="ws-draft-desc">{info.line.description}</span>
                  <InputNumber
                    size="small"
                    min={0}
                    value={it.portion}
                    step={0.01}
                    formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                    parser={(v) => Number((v ?? '0').replace(/,/g, ''))}
                    onChange={(v) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              items: d.items.map((x) => (x.lineId === it.lineId ? { ...x, portion: Number(v ?? 0) } : x)),
                            }
                          : d,
                      )
                    }
                    aria-label={`حصة البند ${info.line.description}`}
                  />
                  <Typography.Text type="secondary" className="financial-numbers" style={{ fontSize: 11 }}>
                    / {formatMoney(info.line.remaining)}
                  </Typography.Text>
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined aria-hidden="true" />}
                    aria-label={`إزالة ${info.line.description}`}
                    onClick={() => setDraft((d) => (d ? { ...d, items: d.items.filter((x) => x.lineId !== it.lineId) } : d))}
                  />
                </div>
              );
            })}
          </div>
          <div className="ws-draft-balance">
            كشفنا <strong className="financial-numbers">{formatMoney(draftBalance.ours)}</strong> ↔ كشفهم{' '}
            <strong className="financial-numbers">{formatMoney(draftBalance.theirs)}</strong>{' '}
            {draftBalance.ok ? (
              <Tag color="success">متوازن ✓</Tag>
            ) : (
              <Tag color="error">فرق {formatMoney(Math.abs(draftBalance.ours - draftBalance.theirs))}</Tag>
            )}
            <Input
              size="small"
              placeholder="ملاحظة (اختياري): سبب الربط اليدوي…"
              value={draft.note}
              maxLength={300}
              style={{ maxWidth: 320, marginInlineStart: 12 }}
              onChange={(e) => setDraft((d) => (d ? { ...d, note: e.target.value } : d))}
            />
          </div>
        </div>
      )}

      {/* بطاقات المجموعات */}
      {(suggested.length > 0 || confirmed.length > 0) && (
        <div className="ws-links-list" aria-label="مجموعات الربط">
          {[...suggested, ...confirmed].map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              lineIndex={lineIndex}
              busy={busy}
              canReconcile={canReconcile && Boolean(open)}
              onConfirm={() => withBusy(() => confirmGroup(g.id), `قُبل الاقتراح #${g.id}`)}
              onReject={() => withBusy(() => rejectGroup(g.id), `رُفض الاقتراح #${g.id} — بنوده تحررت`)}
              onUnlink={() => withBusy(() => unlinkGroup(g.id), 'فُكّ الربط — بنوده تحررت')}
            />
          ))}
        </div>
      )}

      {open && canReconcile && suggested.length === 0 && confirmed.length === 0 && (
        <Alert
          type="info"
          showIcon
          message="بحث النظام لم يجد ما يطابقه بعد"
          description="المحرك يبحث تلقائياً عن أرقام الفواتير والمبالغ المتطابقة (وقبولها القطعي يتم بنفسه). إن ظهرت حالة غامضة رفضها سابقاً، صحّحها بالسحب يدوياً — أو أغلق الجلسة بما تبقى كفروق موثقة."
        />
      )}

      {/* العمودان */}
      <div className="ws-tables">
        {columnBlock('ours')}
        {columnBlock('theirs')}
      </div>

      {detail.ourStatement == null || detail.theirStatement == null ? (
        <Alert
          type="warning"
          showIcon
          message="الكشفان غير مكتملين"
          description="أكمل اعتماد كشفنا وكشف المورد من معالج الجلسة قبل المطابقة."
        />
      ) : null}

      {/* ورقة التسوية */}
      <Modal
        open={settlementOpen}
        onCancel={() => setSettlementOpen(false)}
        footer={[
          <Button key="print" type="primary" icon={<PrinterOutlined aria-hidden="true" />} onClick={() => window.print()}>
            طباعة
          </Button>,
          <Button key="close" onClick={() => setSettlementOpen(false)}>
            إغلاق
          </Button>,
        ]}
        width={720}
      >
        {summary ? (
          <SettlementSheet
            session={session.periodLabel}
            partner={partner.nameAr}
            currency={session.currencyCode}
            matchRatePct={summary.matchRatePct}
            totals={summary.totals}
            discrepancies={summary.discrepancies}
            closedAt={session.closedAt}
          />
        ) : null}
      </Modal>
    </section>
  );
}

/** تأكيد الإغلاق مع تذكير بالمتبقي — الإغلاق لقطة نهائية */
function PopconfirmClose({ onConfirm, progress }: { onConfirm: () => void; progress: SessionDetail['progress'] }) {
  const { modal } = App.useApp();
  const leftovers = progress.ours.leftover + progress.theirs.leftover;
  return (
    <Button
      icon={<LockOutlined aria-hidden="true" />}
      danger={leftovers > 0.005}
      onClick={() =>
        modal.confirm({
          title: 'إغلاق جلسة المطابقة؟',
          content:
            leftovers > 0.005
              ? `ما زال هناك ${formatMoney(leftovers)} بنود غير مربوطة — ستُوثَّق كفروق متبقية في لقطة الإغلاق.`
              : 'كل البنود مربوطة — سيُحفظ ملخص الإغلاق وتتجمّد المطابقات.',
          okText: 'إغلاق الجلسة',
          cancelText: 'تراجع',
          onOk: onConfirm,
        })
      }
    >
      إغلاق الجلسة
    </Button>
  );
}

/** بطاقة مجموعة: اقتراح (قبول/رفض) أو مؤكد (فك) — شفافية القاعدة والثقة */
function GroupCard({
  group,
  lineIndex,
  busy,
  canReconcile,
  onConfirm,
  onReject,
  onUnlink,
}: {
  group: MatchGroup;
  lineIndex: Map<number, { line: WsLine; side: 'ours' | 'theirs' }>;
  busy: boolean;
  canReconcile: boolean;
  onConfirm: () => void;
  onReject: () => void;
  onUnlink: () => void;
}) {
  const ourItems = group.items.filter((i) => lineIndex.get(i.lineId)?.side === 'ours');
  const theirItems = group.items.filter((i) => lineIndex.get(i.lineId)?.side === 'theirs');
  const renderSide = (items: typeof ourItems) => (
    <div className="match-card-side">
      {items.map((i) => {
        const info = lineIndex.get(i.lineId);
        if (!info) return null;
        const portion = Math.abs(i.allocated ?? info.line.signed);
        const partial = portion + 0.005 < Math.abs(info.line.signed);
        return (
          <span key={i.lineId} className="match-card-line">
            <span className="financial-numbers">{info.line.entryDate ?? '—'}</span> · {info.line.description}{' '}
            <span className="financial-numbers">
              {formatMoney(portion)}
              {partial ? ` (من ${formatMoney(Math.abs(info.line.signed))})` : ''}
            </span>
          </span>
        );
      })}
    </div>
  );

  return (
    <div className="match-card">
      <div className="match-card-head">
        {group.status === 'confirmed' ? (
          <Tag color="success">
            {group.rule === 'manual' ? 'ربط يدوي' : 'مؤكد آلياً ✓'}
          </Tag>
        ) : (
          <Tag color="processing">اقتراح — بانتظار مراجعتك</Tag>
        )}
        <Tag>{RULE_LABELS[group.rule as MatchRule]}</Tag>
        {group.confidence != null && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            ثقة <span className="financial-numbers">{Math.round(group.confidence * 100)}%</span>
          </Typography.Text>
        )}
        {group.note && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {group.note}
          </Typography.Text>
        )}
        {canReconcile && group.status === 'suggested' && (
          <Space>
            <Button size="small" type="primary" icon={<CheckOutlined aria-hidden="true" />} loading={busy} onClick={onConfirm}>
              قبول
            </Button>
            <Button size="small" danger icon={<CloseOutlined aria-hidden="true" />} loading={busy} onClick={onReject}>
              رفض
            </Button>
          </Space>
        )}
        {canReconcile && group.status === 'confirmed' && (
          <Button size="small" icon={<UnlockOutlined aria-hidden="true" />} loading={busy} onClick={onUnlink}>
            فك الربط
          </Button>
        )}
      </div>
      <div className="match-card-body">
        {renderSide(ourItems)}
        <div className="match-card-link-icon" aria-hidden="true">
          <LinkOutlined />
        </div>
        {renderSide(theirItems)}
      </div>
    </div>
  );
}

/** ورقة تسوية قابلة للطباعة — نفس نمط تقارير النظام (A4) */
function SettlementSheet({
  session,
  partner,
  currency,
  matchRatePct,
  totals,
  discrepancies,
  closedAt,
}: {
  session: string;
  partner: string;
  currency: string;
  matchRatePct: number;
  totals: { ours: SessionDetail['progress']['ours']; theirs: SessionDetail['progress']['theirs'] };
  discrepancies: CloseDiscrepancy[];
  closedAt: string | null;
}) {
  return (
    <div className="report-paper settlement-paper" dir="rtl">
      <header className="settlement-head">
        <h2>ورقة تسوية مطابقة</h2>
        <p>
          المورد: <strong>{partner}</strong> · الفترة: <strong className="financial-numbers">{session}</strong> · العملة:{' '}
          <strong>{currency}</strong>
        </p>
        {closedAt && (
          <p className="financial-numbers">
            أُغلقت في {closedAt.slice(0, 10)}
          </p>
        )}
      </header>
      <table className="settlement-table">
        <tbody>
          <tr>
            <th>نسبة المطابقة المؤكدة</th>
            <td className="financial-numbers">{matchRatePct.toFixed(1)}%</td>
          </tr>
          <tr>
            <th>كشفنا — مربوط / متبقٍ</th>
            <td className="financial-numbers">
              {formatMoney(totals.ours.matchedConfirmed)} / {formatMoney(totals.ours.leftover)}
            </td>
          </tr>
          <tr>
            <th>كشف المورد — مربوط / متبقٍ</th>
            <td className="financial-numbers">
              {formatMoney(totals.theirs.matchedConfirmed)} / {formatMoney(totals.theirs.leftover)}
            </td>
          </tr>
        </tbody>
      </table>
      <h3 className="settlement-sub">الفروق المتبقية ({discrepancies.length})</h3>
      {discrepancies.length === 0 ? (
        <p>لا فروق متبقية — الكشفان متطابقان بالكامل ✓</p>
      ) : (
        <table className="settlement-table">
          <thead>
            <tr>
              <th>الجهة</th>
              <th>البند</th>
              <th>التاريخ</th>
              <th>المبلغ</th>
            </tr>
          </thead>
          <tbody>
            {discrepancies.map((d, i) => (
              <tr key={i}>
                <td>{d.type === 'ours_only' ? 'عندنا فقط' : 'عندهم فقط'}</td>
                <td>{d.description}</td>
                <td className="financial-numbers">{d.date ?? '—'}</td>
                <td className="financial-numbers">{formatMoney(d.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <footer className="settlement-signs">
        <span>توقيع المحاسب: ..................</span>
        <span>توقيع المدير المالي: ..................</span>
      </footer>
    </div>
  );
}
