import { CheckCircleFilled, CloseCircleFilled, FileTextOutlined, InboxOutlined } from '@ant-design/icons';
import { Alert, App, Button, Input, InputNumber, Select, Space, Spin, Table, Tooltip, Typography, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import type { CommittedStatementInfo, ParsedStatement, PreviewLine, StatementSide } from '@/shared/types';
import { computeTotalsCheck, formatMoney, validateLine } from './statementValidation';
import {
  commitStatementPreview,
  listAccountTemplates,
  patchPreviewLine,
  toPreviewLine,
  uploadStatementPreview,
  commitManualStatement,
  ocrStatementPdf,
} from './statementsClient';

/**
 * خطوة رفع كشف واحدة (تُستخدم مرتين: كشفنا / كشف المورد) — وثيقة التصميم §4:
 * رفع ← اختيار قالب ← معاينة قابلة للتصحيح + محقق ثلاثي ← اعتماد.
 * متصلة بالخادم (Module 3): الرفع يُنشئ معاينة بالذاكرة (توكن 30 دقيقة)،
 * كل تصحيح يُحفظ فوراً في المعاينة الخادمية، والاعتماد يكتب الكشف نهائياً.
 */

interface StatementUploadStepProps {
  side: StatementSide;
  accountId: number | null;
  /** جلسة المطابقة — الكشف المعتمد يرتبط بها (Module 4) */
  sessionId: number | null;
  completed: boolean;
  onCommitted: (info: CommittedStatementInfo) => void;
}

const SIDE_LABELS: Record<StatementSide, string> = { ours: 'كشفنا (نظامنا المحاسبي)', theirs: 'كشف المورد' };

interface ServerTemplate {
  id: number;
  name: string;
  templateKind: 'ours' | 'theirs';
  isDefault: boolean;
}

export function StatementUploadStep({ side, accountId, sessionId, completed, onCommitted }: StatementUploadStepProps) {
  const { message } = App.useApp();

  const [fileMeta, setFileMeta] = useState<{ name: string; sizeKb: number } | null>(null);
  const [templates, setTemplates] = useState<ServerTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>(''); // '' = تلقائي (أعمدة A–E)
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [announcedClosing, setAnnouncedClosing] = useState<number | null>(null);
  const [announcedCount, setAnnouncedCount] = useState<number | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [highlightLineNo, setHighlightLineNo] = useState<number | null>(null);
  const [committing, setCommitting] = useState(false);
  /** مسودة OCR: بنود مستخرجة من PDF محلياً — المراجعة إلزامية والاعتماد عبر مسار الإدخال اليدوي */
  const [ocrDraft, setOcrDraft] = useState(false);

  // قوالب الاستيراد المحفوظة لهذا الحساب (FR-2.3) — تُصفّى حسب جهة الكشف
  useEffect(() => {
    if (!accountId) return;
    listAccountTemplates(accountId)
      .then((all) => setTemplates(all.filter((t) => t.templateKind === side)))
      .catch(() => setTemplates([]));
  }, [accountId, side]);

  const templateOptions = [
    { value: '', label: 'تلقائي (أعمدة A–E)' },
    ...templates.map((t) => ({
      value: String(t.id),
      label: `${t.name}${t.isDefault ? ' ★' : ''}`,
    })),
  ];

  const errorsByLine = useMemo(() => {
    const map = new Map<number, ReturnType<typeof validateLine>>();
    lines.forEach((l) => {
      const errs = validateLine(l);
      if (errs.length > 0) map.set(l.lineNo, errs);
    });
    return map;
  }, [lines]);

  const totalErrors = errorsByLine.size;
  const totals = parsed
    ? computeTotalsCheck(lines, parsed.opening, side, announcedClosing, announcedCount)
    : null;

  /** استخراج PDF محلياً (طبقة نصية أو OCR) → مسودة مراجعة إلزامية */
  const handlePdfOcr = (file: File) => {
    if (!accountId) {
      message.error('اختر المورد والعملة في الخطوة السابقة أولاً');
      return;
    }
    setFileMeta({ name: file.name, sizeKb: Math.max(1, Math.round(file.size / 1024)) });
    setParsing(true);
    setParsed(null);
    setPreviewToken(null);
    ocrStatementPdf(accountId, side, file)
      .then((draft) => {
        const rows = Array.isArray(draft?.lines) ? draft.lines : [];
        if (rows.length === 0) throw new Error('لم يُستخرج أي بند من الملف — أعد تصدير الكشف من نظامك كـ PDF نصي أو Excel/CSV ثم ارفعه');
        const mapped = rows.map((l) => ({
          lineNo: l.lineNo,
          dateRaw: l.dateRaw,
          docType: '',
          docNo: '',
          description: l.description,
          ref: l.ref,
          debitRaw: l.debitRaw,
          creditRaw: l.creditRaw,
        }));
        setLines(mapped);
        setOcrDraft(true);
        setParsed({ opening: draft.opening ?? null, lines: mapped, announcedClosing: null, announcedCount: null });
        setParsing(false);
        message.info(
          draft.mode === 'text'
            ? `استُخرجت ${rows.length} بنداً من طبقة PDF النصية — راجع كل بند (المبالغ والاتجاه) قبل الاعتماد`
            : `قرأ النظام ${rows.length} بنداً من الملف الممسوح — المراجعة إلزامية فالقراءة الآلية قد تخطئ`,
        );
      })
      .catch((e: { messageAr?: string; message?: string }) => {
        setParsing(false);
        setFileMeta(null);
        // الرسالة لا تكون عارية أبداً: سبب الخادم، أو نص الخطأ الفعلي
        message.error(e?.messageAr ?? e?.message ?? 'تعذر استخراج بنود الملف');
      });
  };

  const handleFile = (file: File) => {
    if (!accountId) {
      message.error('اختر المورد والعملة في الخطوة السابقة أولاً');
      return;
    }
    setFileMeta({ name: file.name, sizeKb: Math.max(1, Math.round(file.size / 1024)) });
    setParsing(true);
    setParsed(null);
    setPreviewToken(null);
    uploadStatementPreview(accountId, side, file, templateId || null)
      .then((p) => {
        const mapped = p.lines.map(toPreviewLine);
        setPreviewToken(p.token);
        setLines(mapped);
        setParsed({ opening: p.opening, lines: mapped, announcedClosing: null, announcedCount: null });
        setParsing(false);
        message.success(`حُلّل الملف: ${p.lineCount} بنداً — راجع المعاينة قبل الاعتماد`);
      })
      .catch((e: { messageAr?: string; message?: string }) => {
        setParsing(false);
        setFileMeta(null);
        message.error(e?.messageAr ?? e?.message ?? 'فشل تحليل الملف');
      });
  };

  /** تصحيح بند: محلي فوري + حفظ في المعاينة الخادمية (مرجع الاعتماد) */
  const updateLine = (lineNo: number, field: keyof PreviewLine, value: string) => {
    const valueBefore = lines.find((l) => l.lineNo === lineNo)?.[field] ?? '';
    setLines((prev) => prev.map((l) => (l.lineNo === lineNo ? { ...l, [field]: value } : l)));
    if (!previewToken) return;
    patchPreviewLine(previewToken, lineNo, { [field]: value }).catch(() => {
      message.error('تعذر حفظ التعديل على الخادم — أُعيد النص السابق');
      setLines((prev) => prev.map((l) => (l.lineNo === lineNo ? { ...l, [field]: valueBefore } : l)));
    });
  };

  const commit = () => {
    if (!parsed || totalErrors > 0) return;
    if (ocrDraft && !previewToken && accountId) {
      // مسودة OCR: اعتماد عبر مسار الإدخال اليدوي بعد المراجعة الإلزامية
      setCommitting(true);
      commitManualStatement(accountId, side, {
        openingBalance: parsed.opening,
        sessionId,
        lines: lines.map((l) => ({
          entryDate: l.dateRaw,
          description: l.description,
          ref: l.ref || undefined,
          debit: l.debitRaw ? Number(l.debitRaw) : null,
          credit: l.creditRaw ? Number(l.creditRaw) : null,
        })),
      })
        .then((res) => {
          setCommitting(false);
          message.success(`اعتُمد ${SIDE_LABELS[side]} بعد المراجعة — كشف #${res.statementId} (${res.lineCount} بنداً)`);
          onCommitted({
            fileName: fileMeta?.name ?? 'PDF',
            lines,
            parsed: { opening: parsed.opening, lines, announcedClosing: totals?.computedClosing ?? null, announcedCount: lines.length },
            statementId: res.statementId,
            totalDebit: res.totalDebit,
            totalCredit: res.totalCredit,
          });
        })
        .catch((e: { messageAr?: string; message?: string }) => {
          setCommitting(false);
          message.error(e?.messageAr ?? 'فشل اعتماد البنود المستخرجة');
        });
      return;
    }
    if (!previewToken) return;
    setCommitting(true);
    commitStatementPreview(previewToken, {
      openingBalance: parsed.opening,
      announcedClosing,
      announcedCount,
      sessionId,
    })
      .then((res) => {
        setCommitting(false);
        message.success(
          `اعتُمد ${SIDE_LABELS[side]} — كشف #${res.statementId} (${res.lineCount} بنداً)`,
        );
        onCommitted({
          fileName: fileMeta?.name ?? 'ملف',
          lines,
          parsed: {
            opening: parsed.opening,
            lines,
            announcedClosing: announcedClosing ?? totals!.computedClosing,
            announcedCount: announcedCount ?? lines.length,
          },
          statementId: res.statementId,
          totalDebit: res.totalDebit,
          totalCredit: res.totalCredit,
        });
      })
      .catch((e: { messageAr?: string; message?: string }) => {
        setCommitting(false);
        message.error(e?.messageAr ?? e?.message ?? 'فشل اعتماد الكشف');
      });
  };

  const columns: ColumnsType<PreviewLine> = [
    {
      title: '#',
      dataIndex: 'lineNo',
      key: 'no',
      width: 40,
      render: (n: number) => <span className="financial-numbers line-no">{n}</span>,
    },
    {
      title: 'التاريخ',
      dataIndex: 'dateRaw',
      key: 'date',
      width: 130,
      render: (v: string, row) => (
        <EditableCell
          value={v}
          error={errorsByLine.get(row.lineNo)?.find((e) => e.field === 'date')}
          onChange={(val) => updateLine(row.lineNo, 'dateRaw', val)}
          onFocusLine={setHighlightLineNo}
          lineNo={row.lineNo}
          dir="ltr"
        />
      ),
    },
    { title: 'نوع المستند', dataIndex: 'docType', key: 'docType', width: 120 },
    {
      title: 'رقم المستند',
      dataIndex: 'docNo',
      key: 'docNo',
      width: 100,
      render: (v: string) => <span className="financial-numbers">{v}</span>,
    },
    {
      title: 'البيان',
      dataIndex: 'description',
      key: 'desc',
      render: (v: string, row) => (
        <EditableCell
          value={v}
          error={errorsByLine.get(row.lineNo)?.find((e) => e.field === 'description')}
          onChange={(val) => updateLine(row.lineNo, 'description', val)}
          onFocusLine={setHighlightLineNo}
          lineNo={row.lineNo}
        />
      ),
    },
    {
      title: 'مرجع',
      dataIndex: 'ref',
      key: 'ref',
      width: 70,
      render: (v: string) => (
        <Tooltip title="عمود مرجع الطرف — منخفض الثقة حسب التحليل (stage-2b §2.2)">
          <span className="ref-dim financial-numbers">{v}</span>
        </Tooltip>
      ),
    },
    {
      title: 'مدين',
      dataIndex: 'debitRaw',
      key: 'debit',
      width: 140,
      render: (v: string, row) => (
        <EditableCell
          value={v}
          error={errorsByLine.get(row.lineNo)?.find((e) => e.field === 'debit')}
          onChange={(val) => updateLine(row.lineNo, 'debitRaw', val)}
          onFocusLine={setHighlightLineNo}
          lineNo={row.lineNo}
          dir="ltr"
          placeholder="—"
        />
      ),
    },
    {
      title: 'دائن',
      dataIndex: 'creditRaw',
      key: 'credit',
      width: 140,
      render: (v: string, row) => (
        <EditableCell
          value={v}
          error={errorsByLine.get(row.lineNo)?.find((e) => e.field === 'credit')}
          onChange={(val) => updateLine(row.lineNo, 'creditRaw', val)}
          onFocusLine={setHighlightLineNo}
          lineNo={row.lineNo}
          dir="ltr"
          placeholder="—"
        />
      ),
    },
    {
      title: '',
      key: 'status',
      width: 40,
      render: (_, row) =>
        errorsByLine.has(row.lineNo) ? (
          <CloseCircleFilled style={{ color: 'var(--color-error)' }} aria-label="بند به خطأ" />
        ) : (
          <CheckCircleFilled style={{ color: 'var(--color-success)' }} aria-label="بند سليم" />
        ),
    },
  ];

  if (completed) {
    return (
      <Alert
        type="success"
        showIcon
        icon={<CheckCircleFilled />}
        message={`${SIDE_LABELS[side]} — معتمد ✓`}
        description={
          <Typography.Text type="secondary">
            {fileMeta?.name} · {lines.length} بنداً · الختامي {totals && formatMoney(totals.computedClosing)}
          </Typography.Text>
        }
      />
    );
  }

  return (
    <div className="upload-step">
      {!fileMeta && (
        <>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            {SIDE_LABELS[side]} — ارفع ملف Excel (xlsx/xls) أو CSV — أو PDF (يُقرأ محلياً للمراجعة)
          </Typography.Paragraph>
          <Upload.Dragger
            accept=".xlsx,.xls,.csv,.pdf"
            showUploadList={false}
            multiple={false}
            disabled={parsing || !accountId}
            beforeUpload={(file) => {
              const ext = `.${(file.name.split('.').pop() ?? '').toLowerCase()}`;
              if (ext === '.pdf') {
                handlePdfOcr(file); // استيراد PDF محلي (M11) — مسودة مراجعة
                return false;
              }
              if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
                message.error('صيغة غير مدعومة — المسموح: Excel (xlsx/xls) أو CSV أو PDF');
                return Upload.LIST_IGNORE;
              }
              setOcrDraft(false);
              handleFile(file);
              return false; // الرفع اليدوي عبر statementsClient — لا سلوك أنتد التلقائي
            }}
            className="upload-dragger"
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined aria-hidden="true" />
            </p>
            <p className="ant-upload-text">اسحب الملف هنا أو انقر للاختيار</p>
            <p className="ant-upload-hint">
              المسموح: Excel (xlsx/xls) أو CSV — وPDF يُقرأ محلياً (طبقة نصية أو OCR) ثم تراجع بنوده قبل الاعتماد · يُفحص الملف تلقائياً (تواريخ، مبالغ، تسلسل الأرصدة) قبل الحفظ — FR-3.4
            </p>
          </Upload.Dragger>
          <Space wrap style={{ marginTop: 12 }}>
          </Space>
        </>
      )}

      {fileMeta && parsing && (
        <div className="parse-loading" role="status">
          <Spin />
          <Typography.Text type="secondary">جارٍ تحليل «{fileMeta.name}»…</Typography.Text>
        </div>
      )}

      {fileMeta && !parsing && parsed && (
        <>
          <div className="upload-filebar">
            <Space wrap>
              <FileTextOutlined aria-hidden="true" />
              <strong>{fileMeta.name}</strong>
              <Typography.Text type="secondary">({fileMeta.sizeKb} KB)</Typography.Text>
              <Select
                value={templateId}
                onChange={(v) => {
                  setTemplateId(v);
                  if (parsed) {
                    // القالب يغيّر تفسير الأعمدة — تُلغى المعاينة الحالية
                    setParsed(null);
                    setPreviewToken(null);
                    setFileMeta(null);
                    message.info('غيّرت القالب — أعد رفع الملف لتطبيقه');
                  }
                }}
                style={{ minWidth: 280 }}
                aria-label="قالب الاستيراد"
                options={templateOptions}
              />
              <Button
                size="small"
                onClick={() => {
                  setFileMeta(null);
                  setParsed(null);
                  setLines([]);
                }}
              >
                تغيير الملف
              </Button>
            </Space>
          </div>

          {/* محقق التوثيق الثلاثي — مستمد من تحليل العينة الفعلية (stage-2b §2.3) */}
          <div className="totals-bar" role="status" aria-label="محقق التوثيق">
            <div className="totals-item">
              <span>الافتتاحي</span>
              <strong className="financial-numbers">{formatMoney(parsed.opening ?? 0)}</strong>
            </div>
            <div className="totals-item">
              <span>Σ مدين</span>
              <strong className="financial-numbers">{formatMoney(totals!.totalDebit)}</strong>
            </div>
            <div className="totals-item">
              <span>Σ دائن</span>
              <strong className="financial-numbers">{formatMoney(totals!.totalCredit)}</strong>
            </div>
            <div className="totals-item">
              <span>الختامي المحسوب</span>
              <strong className="financial-numbers">{formatMoney(totals!.computedClosing)}</strong>
            </div>
            <div className="totals-item">
              <span>الختامي المعلن (اختياري)</span>
              <InputNumber
                size="small"
                value={announcedClosing}
                onChange={(v) => setAnnouncedClosing(v)}
                placeholder="إن ورد في الترويسة"
                className="financial-numbers"
                style={{ width: 130 }}
                aria-label="الرصيد الختامي المعلن في ترويسة الكشف"
              />
            </div>
            <div className="totals-item">
              <span>عدد البنود المعلن</span>
              <InputNumber
                size="small"
                precision={0}
                value={announcedCount}
                onChange={(v) => setAnnouncedCount(v)}
                placeholder="—"
                className="financial-numbers"
                style={{ width: 90 }}
                aria-label="عدد البنود المعلن في ترويسة الكشف"
              />
            </div>
            <div className={`totals-check ${announcedCount === null ? '' : totals!.countOk ? 'ok' : 'bad'}`}>
              {announcedCount === null
                ? 'العدد: غير معلن'
                : totals!.countOk
                  ? `العدد مطابق ✓ (${lines.length}/${announcedCount})`
                  : `العدد مختلف ✗ (${lines.length}/${announcedCount})`}
            </div>
            <div className={`totals-check ${announcedClosing === null ? '' : totals!.closingOk ? 'ok' : 'bad'}`}>
              {announcedClosing === null
                ? 'الختامي: غير معلن'
                : totals!.closingOk
                  ? 'الختامي مطابق ✓'
                  : `فرق ختامي ✗ (${formatMoney(Math.abs(totals!.computedClosing - (announcedClosing ?? 0)))})`}
            </div>
          </div>

          {totalErrors > 0 ? (
            <Alert
              type="error"
              showIcon
              message={`${totalErrors} بنداً يحتاج تصحيحاً قبل الاعتماد`}
              description={
                <ul className="issue-list">
                  {[...errorsByLine.entries()].slice(0, 5).map(([lineNo, errs]) => (
                    <li key={lineNo}>
                      <button
                        type="button"
                        className="issue-jump"
                        onClick={() => setHighlightLineNo(lineNo)}
                      >
                        بند {lineNo}
                      </button>
                      {errs.map((e, i) => (
                        <Typography.Text key={i} type="secondary">
                          {' '}
                          — {e.message}
                        </Typography.Text>
                      ))}
                    </li>
                  ))}
                  {errorsByLine.size > 5 && (
                    <li>
                      <Typography.Text type="secondary">
                        و{errorsByLine.size - 5} أخطاء أخرى…
                      </Typography.Text>
                    </li>
                  )}
                </ul>
              }
            />
          ) : (
            <Alert
              type="success"
              showIcon
              message="كل البنود سليمة ومحقق التوثيق متطابق — يمكن الاعتماد"
            />
          )}

          <Table<PreviewLine>
            rowKey="lineNo"
            size="small"
            columns={columns}
            dataSource={lines}
            pagination={false}
            scroll={{ x: 900 }}
            className="preview-table"
            rowClassName={(row) =>
              [
                errorsByLine.has(row.lineNo) ? 'row-has-error' : '',
                highlightLineNo === row.lineNo ? 'row-highlight' : '',
              ]
                .filter(Boolean)
                .join(' ')
            }
          />

          <div className="commit-row">
            <Tooltip title={totalErrors > 0 ? 'صحّح الأخطاء أولاً' : 'الحفظ النهائي للكشف'}>
              <Button type="primary" disabled={totalErrors > 0} loading={committing} onClick={commit}>
                اعتماد الكشف
              </Button>
            </Tooltip>
          </div>
        </>
      )}
    </div>
  );
}

/** خلية معاينة قابلة للتصحيح — تُظهر الخطأ فورياً (FR-3.3) */
function EditableCell({
  value,
  error,
  onChange,
  onFocusLine,
  lineNo,
  dir,
  placeholder,
}: {
  value: string;
  error?: { message: string };
  onChange: (v: string) => void;
  onFocusLine: (n: number) => void;
  lineNo: number;
  dir?: 'ltr' | 'rtl';
  placeholder?: string;
}) {
  return (
    <Tooltip title={error?.message} open={error ? undefined : false}>
      <Input
        size="small"
        value={value}
        status={error ? 'error' : undefined}
        dir={dir}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-label={error ? `${error.message}` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => onFocusLine(lineNo)}
        className="financial-numbers"
        style={{ textAlign: dir === 'ltr' ? 'left' : undefined }}
      />
    </Tooltip>
  );
}
