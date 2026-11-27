import { CheckCircleFilled, CloseCircleFilled, FileTextOutlined, InboxOutlined } from '@ant-design/icons';
import { Alert, App, Button, Checkbox, Input, InputNumber, Select, Space, Spin, Table, Tooltip, Typography, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CommittedStatementInfo, ParsedStatement, PreviewLine, StatementSide } from '@/shared/types';
import { computeTotalsCheck, formatMoney, validateLine } from './statementValidation';
import {
  commitStatementPreview,
  inspectStatementFile,
  listAccountTemplates,
  patchPreviewLine,
  toPreviewLine,
  uploadStatementPreview,
  ocrStatementPdf,
} from './statementsClient';
import type { InspectColumn, InspectResult, MappingField, UploadOptions } from './statementsClient';

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
  decimalSep: string;
  thousandSep: string;
}

/** حقول تعيين الأعمدة كما تظهر في القائمة المنسدلة */
const MAPPING_FIELDS: Array<{ value: MappingField; label: string }> = [
  { value: 'date', label: 'التاريخ' },
  { value: 'docType', label: 'نوع المستند' },
  { value: 'docNo', label: 'رقم المستند' },
  { value: 'description', label: 'البيان' },
  { value: 'ref', label: 'المرجع' },
  { value: 'debit', label: 'مدين' },
  { value: 'credit', label: 'دائن' },
  { value: 'amount', label: 'المبلغ' },
  { value: 'balance', label: 'الرصيد (كمبلغ)' },
  { value: 'currency', label: 'العملة (تُهمل)' },
];

/** نتيجة الفحص → خريطة عمود/حقل للعرض والتحرير */
function toColumnFields(inspection: InspectResult): Record<string, MappingField | ''> {
  const byLetter: Record<string, MappingField | ''> = {};
  for (const column of inspection.columns) byLetter[column.letter] = '';
  for (const [field, letter] of Object.entries(inspection.mapping)) {
    if (letter && field in byLetter) byLetter[letter] = field as MappingField;
  }
  return byLetter;
}

export function StatementUploadStep({ side, accountId, sessionId, completed, onCommitted }: StatementUploadStepProps) {
  const { message } = App.useApp();

  const [fileMeta, setFileMeta] = useState<{ name: string; sizeKb: number } | null>(null);
  const [templates, setTemplates] = useState<ServerTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>(''); // '' = تلقائي (تعرّف على الأعمدة)
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [announcedClosing, setAnnouncedClosing] = useState<number | null>(null);
  const [announcedCount, setAnnouncedCount] = useState<number | null>(null);
  const [parsing, setParsing] = useState(false);
  /** ملف بانتظار تأكيد تعيين الأعمدة (فحص الملف لم يُرفع بعد) */
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<InspectResult | null>(null);
  const [columnFields, setColumnFields] = useState<Record<string, MappingField | ''>>({});
  const [headerRows, setHeaderRows] = useState(1);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('تقارير المطابقة التجريبية');
  const [templateIsDefault, setTemplateIsDefault] = useState(false);
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [highlightLineNo, setHighlightLineNo] = useState<number | null>(null);
  const [committing, setCommitting] = useState(false);
  const [savingEdits, setSavingEdits] = useState(0);
  const pendingEdits = useRef(new Map<number, Promise<unknown>>());
  /** مسودة OCR: بنود مستخرجة من PDF/صورة — الاعتماد عبر المعاينة الخادمية بعد المراجعة */
  const [ocrDraft, setOcrDraft] = useState(false);
  const [ocrReviewed, setOcrReviewed] = useState(false);

  // قوالب الاستيراد المحفوظة لهذا الحساب (FR-2.3) — تُصفّى حسب جهة الكشف
  useEffect(() => {
    if (!accountId) return;
    listAccountTemplates(accountId)
      .then((all) => setTemplates(all.filter((t) => t.templateKind === side)))
      .catch(() => setTemplates([]));
  }, [accountId, side]);

  const templateOptions = [
    { value: '', label: 'تلقائي (تعرّف على الأعمدة)' },
    ...templates.map((t) => ({
      value: String(t.id),
      label: `${t.name}${t.isDefault ? ' ★' : ''}`,
    })),
  ];

  const decimalSep = parsed?.decimalSep ?? '.';
  const thousandSep = parsed?.thousandSep ?? ',';
  const errorsByLine = useMemo(() => {
    const map = new Map<number, ReturnType<typeof validateLine>>();
    lines.forEach((l) => {
      const errs = validateLine(l, decimalSep, thousandSep);
      if (errs.length > 0) map.set(l.lineNo, errs);
    });
    return map;
  }, [lines, decimalSep, thousandSep]);

  const totalErrors = errorsByLine.size;
  const totals = parsed
    ? computeTotalsCheck(lines, parsed.opening, side, announcedClosing, announcedCount, decimalSep, thousandSep)
    : null;
  const totalsMismatch = Boolean(totals && (!totals.closingOk || !totals.countOk));

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
    setAnnouncedClosing(null);
    setAnnouncedCount(null);
    setInspection(null);
    setPendingFile(null);
    ocrStatementPdf(accountId, side, file)
      .then((draft) => {
        const rows = Array.isArray(draft?.lines) ? draft.lines : [];
        if (rows.length === 0) throw new Error('لم يُستخرج أي بند من الملف — أعد تصدير الكشف كـ PDF نصي أو Excel/CSV، أو أعد تصويره بوضوح أفضل ثم ارفعه');
        const mapped = rows.map((l) => ({
          lineNo: l.lineNo,
          dateRaw: l.dateRaw,
          docType: '',
          docNo: '',
          description: l.description,
          ref: l.ref,
          debitRaw: l.debitRaw,
          creditRaw: l.creditRaw,
          ocrConfidence: l.ocrConfidence,
        }));
        setLines(mapped);
        setPreviewToken(draft.token);
        setOcrDraft(true);
        setOcrReviewed(false);
        setParsed({ opening: draft.opening ?? null, lines: mapped, announcedClosing: null, announcedCount: null });
        setParsing(false);
        message.info(
          draft.mode === 'text'
            ? `استُخرجت ${rows.length} بنداً من ${draft.pages} صفحة PDF — راجع كل بند (المبالغ والاتجاه) قبل الاعتماد`
            : `استُخرجت ${rows.length} بنداً من ${draft.pages} صفحة/صورة — المراجعة إلزامية فالقراءة الآلية قد تخطئ`,
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
    setAnnouncedClosing(null);
    setAnnouncedCount(null);
    setInspection(null);
    setPendingFile(null);
    setOcrDraft(false);
    // قالب محفوظ مختار: رفع مباشر. «تلقائي»: فحص الأعمدة أولاً وعرض التعيين للمراجعة
    if (templateId) {
      uploadSpreadsheet(file);
      return;
    }
    setPendingFile(file);
    inspectStatementFile(accountId, side, file)
      .then((result) => {
        setInspection(result);
        setHeaderRows(result.headerRows);
        setColumnFields(toColumnFields(result));
        setParsing(false);
      })
      .catch((e: { messageAr?: string; message?: string }) => {
        setParsing(false);
        setFileMeta(null);
        setPendingFile(null);
        message.error(e?.messageAr ?? e?.message ?? 'فشل فحص أعمدة الملف');
      });
  };

  /** الرفع الفعلي للمعاينة بعد تأكيد التعيين (أو مباشرة مع قالب محفوظ) */
  const uploadSpreadsheet = (file: File, options: UploadOptions = {}) => {
    if (!accountId) return;
    setParsing(true);
    setParsed(null);
    setPreviewToken(null);
    setAnnouncedClosing(null);
    setAnnouncedCount(null);
    setInspection(null);
    setPendingFile(null);
    uploadStatementPreview(accountId, side, file, templateId || null, options)
      .then((p) => {
        const mapped = p.lines.map(toPreviewLine);
        setPreviewToken(p.token);
        setLines(mapped);
        setParsed({ opening: p.opening, lines: mapped, announcedClosing: null, announcedCount: null, templateId: p.templateId, decimalSep: p.decimalSep, thousandSep: p.thousandSep });
        setParsing(false);
        message.success(`حُلّلت ورقة «${p.sheetName}»: ${p.lineCount} بنداً — راجع المعاينة قبل الاعتماد`);
        if (options.saveTemplate) {
          message.success(`حُفظ القالب «${options.saveTemplate.name}» — سيظهر في القائمة`);
          listAccountTemplates(accountId)
            .then((all) => setTemplates(all.filter((t) => t.templateKind === side)))
            .catch(() => undefined);
        }
      })
      .catch((e: { messageAr?: string; message?: string }) => {
        setParsing(false);
        setFileMeta(null);
        message.error(e?.messageAr ?? e?.message ?? 'فشل تحليل الملف');
      });
  };

  /** تعيين حقل لعمود — الحقل لا يُستخدم إلا لعمود واحد */
  const setColumnField = (letter: string, field: MappingField | '') => {
    setColumnFields((prev) => {
      const next = { ...prev };
      if (field) {
        for (const key of Object.keys(next)) if (next[key] === field) next[key] = '';
      }
      next[letter] = field;
      return next;
    });
  };

  const mapping = useMemo(() => {
    const out: Partial<Record<MappingField, string>> = {};
    for (const [letter, field] of Object.entries(columnFields)) {
      if (field) out[field] = letter;
    }
    return out;
  }, [columnFields]);
  const mappingMissingDate = !mapping.date;
  const mappingMissingAmount = !mapping.debit && !mapping.credit && !mapping.amount && !mapping.balance;
  const mappingReady = !mappingMissingDate && !mappingMissingAmount;

  const confirmMapping = () => {
    if (!pendingFile || !inspection || !mappingReady) return;
    uploadSpreadsheet(pendingFile, {
      mapping,
      headerRows,
      decimalSep: inspection.decimalSep,
      thousandSep: inspection.thousandSep,
      saveTemplate:
        saveAsTemplate && templateName.trim()
          ? { name: templateName.trim(), isDefault: templateIsDefault }
          : null,
    });
  };

  /** إلغاء الرفع الحالي والعودة لاختيار ملف جديد — لا يترك معاينة معلّقة */
  const resetUpload = () => {
    setFileMeta(null);
    setParsed(null);
    setLines([]);
    setPreviewToken(null);
    setInspection(null);
    setPendingFile(null);
    setColumnFields({});
    setHeaderRows(1);
    setOcrDraft(false);
    setOcrReviewed(false);
    setAnnouncedClosing(null);
    setAnnouncedCount(null);
  };

  /** تصحيح بند: محلي فوري + حفظ في المعاينة الخادمية (مرجع الاعتماد) */
  const updateLine = (lineNo: number, field: keyof PreviewLine, value: string) => {
    if (ocrDraft) setOcrReviewed(false);
    const valueBefore = lines.find((l) => l.lineNo === lineNo)?.[field] ?? '';
    setLines((prev) => prev.map((l) => (l.lineNo === lineNo ? { ...l, [field]: value } : l)));
    if (!previewToken) return;
    const previous = pendingEdits.current.get(lineNo) ?? Promise.resolve();
    const saved = previous.catch(() => undefined).then(() => patchPreviewLine(previewToken, lineNo, { [field]: value }));
    pendingEdits.current.set(lineNo, saved);
    setSavingEdits(pendingEdits.current.size);
    saved.catch(() => {
      message.error('تعذر حفظ التعديل على الخادم — أُعيد النص السابق');
      setLines((prev) => prev.map((l) => (l.lineNo === lineNo && l[field] === value ? { ...l, [field]: valueBefore } : l)));
    }).finally(() => {
      if (pendingEdits.current.get(lineNo) === saved) {
        pendingEdits.current.delete(lineNo);
        setSavingEdits(pendingEdits.current.size);
      }
    });
  };

  const commit = () => {
    if (!parsed || totalErrors > 0 || totalsMismatch || savingEdits > 0 || (ocrDraft && !ocrReviewed)) return;
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
        message.success(`اعتُمد ${SIDE_LABELS[side]} — كشف #${res.statementId} (${res.lineCount} بنداً)`);
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
      title: ocrDraft ? 'ثقة OCR' : '',
      key: 'status',
      width: ocrDraft ? 100 : 40,
      render: (_, row) => (
        <Space size={4}>
          {errorsByLine.has(row.lineNo)
            ? <CloseCircleFilled style={{ color: 'var(--color-error)' }} aria-label="بند به خطأ" />
            : <CheckCircleFilled style={{ color: 'var(--color-success)' }} aria-label="بند سليم" />}
          {ocrDraft && row.ocrConfidence != null && (
            <Typography.Text type={row.ocrConfidence < 0.9 ? 'warning' : 'secondary'}>
              {Math.round(row.ocrConfidence * 100)}%
            </Typography.Text>
          )}
        </Space>
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
            {SIDE_LABELS[side]} — ارفع ملف Excel (xlsx/xls) أو CSV — أو PDF/صورة (يُقرأ محلياً للمراجعة)
          </Typography.Paragraph>
          <Upload.Dragger
            accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg"
            showUploadList={false}
            multiple={false}
            disabled={parsing || !accountId}
            beforeUpload={(file) => {
              const ext = `.${(file.name.split('.').pop() ?? '').toLowerCase()}`;
              if (ext === '.pdf' || ['.png', '.jpg', '.jpeg'].includes(ext)) {
                handlePdfOcr(file); // استيراد PDF/صورة محلي (M11) — مسودة مراجعة
                return false;
              }
              if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
                message.error('صيغة غير مدعومة — المسموح: Excel (xlsx/xls) أو CSV أو PDF أو صورة (PNG/JPG)');
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
              المسموح: Excel (xlsx/xls) أو CSV — وPDF/صورة يُقرأ محلياً (طبقة نصية أو OCR) ثم تراجع بنوده قبل الاعتماد · يُفحص الملف تلقائياً (تواريخ، مبالغ، تسلسل الأرصدة) قبل الحفظ — FR-3.4
            </p>
          </Upload.Dragger>
        </>
      )}

      {fileMeta && parsing && (
        <div className="parse-loading" role="status">
          <Spin />
          <Typography.Text type="secondary">جارٍ تحليل «{fileMeta.name}»…</Typography.Text>
        </div>
      )}

      {fileMeta && !parsing && inspection && pendingFile && (
        <div className="mapping-panel">
          <Alert
            type={mappingReady ? 'info' : 'warning'}
            showIcon
            message={`تعيين أعمدة «${fileMeta.name}» — ورقة «${inspection.sheetName}»`}
            description="اقترحنا الحقول من ترويسة الملف. راجعها وصحّحها قبل التحليل — كل عمود يُستخدم مرة واحدة، و«تجاهل» تعني ألا يُقرأ."
          />

          {inspection.warnings.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message="تنبيهات التعرّف التلقائي"
              description={
                <ul className="issue-list">
                  {inspection.warnings.map((warning, index) => (
                    <li key={index}>
                      <Typography.Text type="secondary">{warning}</Typography.Text>
                    </li>
                  ))}
                </ul>
              }
            />
          )}

          <Table<InspectColumn>
            rowKey="letter"
            size="small"
            pagination={false}
            dataSource={inspection.columns}
            className="mapping-table"
            columns={[
              { title: 'العمود', dataIndex: 'letter', width: 70, render: (letter: string) => <strong dir="ltr">{letter}</strong> },
              {
                title: 'الترويسة في الملف',
                dataIndex: 'header',
                width: 190,
                render: (header: string) => header || <Typography.Text type="secondary">— بلا ترويسة —</Typography.Text>,
              },
              {
                title: 'أمثلة من الصفوف',
                dataIndex: 'sample',
                render: (sample: string[]) => (
                  <Typography.Text type="secondary" dir="auto">
                    {sample.length ? sample.join(' · ') : '—'}
                  </Typography.Text>
                ),
              },
              {
                title: 'يُقرأ كـ',
                key: 'field',
                width: 210,
                render: (_, column) => (
                  <Select<MappingField | ''>
                    size="small"
                    style={{ width: '100%' }}
                    value={columnFields[column.letter] ?? ''}
                    onChange={(value) => setColumnField(column.letter, value)}
                    aria-label={`حقل العمود ${column.letter}`}
                    options={[{ value: '', label: 'تجاهل' }, ...MAPPING_FIELDS]}
                  />
                ),
              },
            ]}
          />

          <Space wrap className="mapping-controls">
            <span>عدد صفوف الترويسة</span>
            <InputNumber
              size="small"
              min={0}
              max={15}
              precision={0}
              value={headerRows}
              onChange={(value) => setHeaderRows(Number(value ?? 0))}
              aria-label="عدد صفوف الترويسة قبل أول بند"
            />
            <Typography.Text type="secondary">
              الفاصل العشري «{inspection.decimalSep}» · فاصل الآلاف «{inspection.thousandSep}»
            </Typography.Text>
          </Space>

          <Space direction="vertical" size={4} className="mapping-save">
            <Checkbox checked={saveAsTemplate} onChange={(event) => setSaveAsTemplate(event.target.checked)}>
              حفظ هذا التعيين كقالب لهذا النوع من الملفات
            </Checkbox>
            {saveAsTemplate && (
              <Space wrap>
                <Input
                  size="small"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  maxLength={80}
                  style={{ width: 280 }}
                  aria-label="اسم القالب"
                  placeholder="اسم القالب"
                />
                <Checkbox checked={templateIsDefault} onChange={(event) => setTemplateIsDefault(event.target.checked)}>
                  اجعله القالب الافتراضي
                </Checkbox>
              </Space>
            )}
          </Space>

          {!mappingReady && (
            <Alert
              type="error"
              showIcon
              message={
                mappingMissingDate
                  ? 'عيّن عمود التاريخ أولاً'
                  : 'عيّن عمود مبلغ (مدين/دائن أو المبلغ) — لا يكفي التاريخ والبيان'
              }
            />
          )}

          <Space wrap style={{ marginTop: 12 }}>
            <Button type="primary" onClick={confirmMapping} disabled={!mappingReady}>
              متابعة إلى المعاينة
            </Button>
            <Button onClick={resetUpload}>إلغاء واختيار ملف آخر</Button>
          </Space>
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
                  if (parsed || inspection) {
                    // القالب يغيّر تفسير الأعمدة — تُلغى المعاينة الحالية
                    resetUpload();
                    message.info('غيّرت القالب — أعد رفع الملف لتطبيقه');
                  }
                }}
                style={{ minWidth: 280 }}
                aria-label="قالب الاستيراد"
                options={templateOptions}
              />
              <Button size="small" onClick={resetUpload}>
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
                  : `فرق ختامي ✗ (${Math.abs(totals!.computedClosing - (announcedClosing ?? 0)).toFixed(4)})`}
            </div>
          </div>

          {totalErrors > 0 || totalsMismatch ? (
            <Alert
              type="error"
              showIcon
              message={totalErrors > 0 ? `${totalErrors} بنداً يحتاج تصحيحاً قبل الاعتماد` : 'الرصيد الختامي أو عدد البنود المعلن لا يطابق المعاينة'}
              description={
                totalErrors > 0 ? <ul className="issue-list">
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
                </ul> : 'راجع الأرقام المعلنة والبنود قبل الاعتماد'
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
            {ocrDraft && (
              <Checkbox checked={ocrReviewed} onChange={(event) => setOcrReviewed(event.target.checked)}>
                راجعت جميع الصفحات والبنود المستخرجة، وتأكدت من التواريخ والمبالغ واتجاه المدين والدائن
              </Checkbox>
            )}
            <Tooltip title={totalErrors > 0 ? 'صحّح الأخطاء أولاً' : totalsMismatch ? 'راجع الرصيد أو عدد البنود المعلن' : savingEdits > 0 ? 'انتظر حفظ التعديلات' : ocrDraft && !ocrReviewed ? 'أكّد مراجعة مسودة OCR أولاً' : 'الحفظ النهائي للكشف'}>
              <Button type="primary" disabled={totalErrors > 0 || totalsMismatch || savingEdits > 0 || (ocrDraft && !ocrReviewed)} loading={committing} onClick={commit}>
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
