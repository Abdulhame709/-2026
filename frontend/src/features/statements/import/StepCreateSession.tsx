import { Alert, Button, DatePicker, Form, Input, InputNumber, Radio, Select, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { CurrencyBadge } from '@/shared/components/CurrencyBadge';
import { formatMoney } from '@/features/statements/import/statementValidation';
import { fetchOpeningSuggestion } from '@/features/sessions/sessionsClient';
import type { OpeningSuggestion } from '@/features/sessions/sessionsClient';
import type { CurrencyCode, Partner } from '@/shared/types';

/**
 * الخطوة 1 من المعالج: الطرف + العملة + الفترة + الرصيد المرحّل آلياً (D9 — مفعّل)
 * + سبب إجباري لأي تعديل يدوي على المرحَّل + تحذير التعارض.
 */

export interface SessionDraft {
  partner?: string;
  currency?: CurrencyCode;
  period?: Dayjs;
  opening?: number | null;
  openingTouched: boolean;
  openingReason?: string;
  /** المرحَّل الآلي: افتتاحيهم + مصدره — null = لا جلسة سابقة موثقة */
  openingTheirs?: number | null;
  carried?: OpeningSuggestion | null;
}

interface StepCreateSessionProps {
  draft: SessionDraft;
  onChange: (patch: Partial<SessionDraft>) => void;
  /** جلسة مفتوحة بنفس الحساب والفترة (يكتشفها الخادم عند الإنشاء) */
  conflict: { id: number } | null;
  onGoToExisting: () => void;
  partners: Partner[];
}

export function StepCreateSession({ draft, onChange, conflict, onGoToExisting, partners }: StepCreateSessionProps) {
  // مورّدون حقيقيون من الخادم (Module 2) — بدل قائمة العرض الوهمي
  const selectedPartner = partners.find((p) => p.nameAr === draft.partner);
  const partnerCurrencies = selectedPartner?.accounts.map((a) => a.currency) ?? [];
  const selectedAccount = selectedPartner?.accounts.find((a) => a.currency === draft.currency);
  const accountId = selectedAccount?.accountId ?? null;

  // === الترحيل الآلي (D9): سؤال الخادم عن ختامي آخر جلسة مغلقة لهذا الحساب ===
  const [carryLoading, setCarryLoading] = useState(false);
  useEffect(() => {
    // لا حساب محدد بعد: تصفير فوري بلا سؤال الخادم (لا نداءات فاشلة)
    if (!accountId) {
      onChange({ carried: null, opening: null, openingTheirs: null, openingTouched: false, openingReason: undefined });
      setCarryLoading(false);
      return;
    }
    // تبديل الحساب يصفّر المرحَّل والحالة اليدوية — بلا قيم قديمة من حساب آخر
    setCarryLoading(true);
    let alive = true;
    fetchOpeningSuggestion(accountId)
      .then((sug) => {
        if (!alive) return;
        onChange({
          carried: sug,
          opening: sug ? sug.closingOurs : null,
          openingTheirs: sug ? sug.closingTheirs : null,
          openingTouched: false,
          openingReason: undefined,
        });
      })
      .catch(() => {
        if (alive) onChange({ carried: null, opening: null, openingTheirs: null, openingTouched: false, openingReason: undefined });
      })
      .finally(() => alive && setCarryLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const canProceed = Boolean(
    draft.partner &&
      draft.currency &&
      draft.period &&
      // سبب التعديل إجباري: عدّل المستخدم قيمة مرحَّلة آلياً (قرار المالك — توثيق كامل)
      !(draft.carried && draft.openingTouched && (draft.openingReason ?? '').trim().length < 5),
  );
  const reasonMissing = Boolean(draft.carried && draft.openingTouched && (draft.openingReason ?? '').trim().length < 5);

  return (
    <div className="step-create">
      <Form layout="vertical" component="div">
        <Form.Item label="المورد" required>
          <Select<string>
            showSearch
            placeholder="ابحث واختر المورد…"
            value={draft.partner}
            onChange={(name) => onChange({ partner: name, currency: undefined })}
            optionFilterProp="children"
            aria-label="اختيار المورد"
            options={partners.map((p) => ({
              value: p.nameAr,
              label: `${p.nameAr} — ${p.code} · حسابنا: ${p.accounts.map((a) => a.ledgerCode).join(' / ')}`,
            }))}
          />
        </Form.Item>

        <Form.Item label="العملة (لكل عملة كشف مستقل — Q11)" required>
          {partnerCurrencies.length === 0 ? (
            <Typography.Text type="secondary">اختر المورداً أولاً</Typography.Text>
          ) : (
            <Radio.Group
              value={draft.currency}
              onChange={(e) => onChange({ currency: e.target.value as CurrencyCode })}
              aria-label="اختيار العملة"
            >
              {partnerCurrencies.map((c) => (
                <Radio.Button key={c} value={c} className="currency-radio">
                  <CurrencyBadge currency={c} />
                </Radio.Button>
              ))}
            </Radio.Group>
          )}
        </Form.Item>

        <Form.Item label="فترة المطابقة" required>
          <DatePicker
            picker="month"
            format="YYYY-MM"
            value={draft.period}
            onChange={(d) => onChange({ period: d })}
            style={{ width: 200 }}
            aria-label="اختيار الفترة"
          />
        </Form.Item>

        {selectedAccount && (
          <div className="opening-box">
            {draft.carried ? (
              <>
                <Alert
                  type="success"
                  showIcon
                  message={`رُحِّل الافتتاحي آلياً من جلسة ${draft.carried.periodLabel ?? `#${draft.carried.fromSessionId}`} المغلقة`}
                  description={
                    <Typography.Text type="secondary">
                      ختامي موثق محسوب من بنود الجلسة السابقة: عندنا{' '}
                      <span className="financial-numbers">{formatMoney(draft.carried.closingOurs)}</span> · عندهم{' '}
                      <span className="financial-numbers">{formatMoney(draft.carried.closingTheirs)}</span> — أي تعديل
                      يدوي يتطلب سبباً موثقاً.
                    </Typography.Text>
                  }
                  style={{ marginBottom: 12 }}
                />
                <Form.Item label="الرصيد الافتتاحي للفترة — عندنا (مرحَّل آلياً)" style={{ marginBottom: 8 }}>
                  <InputNumber
                    value={draft.opening ?? undefined}
                    onChange={(v) => onChange({ opening: v, openingTouched: true })}
                    step={0.01}
                    style={{ width: 200 }}
                    aria-label="الرصيد الافتتاحي عندنا"
                    status={draft.openingTouched && reasonMissing ? 'warning' : undefined}
                  />
                </Form.Item>
                <Form.Item label="الافتتاحي عندهم (مرحَّل آلياً)" style={{ marginBottom: 0 }}>
                  <InputNumber
                    value={draft.openingTheirs ?? undefined}
                    onChange={(v) => onChange({ openingTheirs: v, openingTouched: true })}
                    step={0.01}
                    style={{ width: 200 }}
                    aria-label="الرصيد الافتتاحي عندهم"
                  />
                </Form.Item>
                {draft.openingTouched && (
                  <Form.Item
                    label="سبب تعديل المرحَّل (إجباري)"
                    validateStatus={reasonMissing ? 'error' : 'success'}
                    help={reasonMissing ? 'اكتب سبب التعديل — 5 أحرف على الأقل (قاعدة التوثيق الكامل)' : undefined}
                    style={{ marginTop: 12, marginBottom: 0 }}
                  >
                    <Input
                      value={draft.openingReason ?? ''}
                      onChange={(e) => onChange({ openingReason: e.target.value })}
                      placeholder="مثال: أُدرج إشعار دائن لم يظهر في كشف يوليو"
                      maxLength={500}
                      aria-label="سبب تعديل الرصيد المرحَّل"
                    />
                  </Form.Item>
                )}
              </>
            ) : (
              <>
                <Typography.Text strong>الرصيد الافتتاحي للفترة (اختياري):</Typography.Text>{' '}
                <Typography.Text type="secondary">
                  {carryLoading
                    ? 'يسأل الخادم عن آخر إقفال موثق لهذا الحساب…'
                    : 'لا توجد جلسة مغلقة سابقة ببنود موثقة — يُكتشف تلقائياً من سطر «رصيد منقول» في الملف، أو أدخله يدوياً'}
                </Typography.Text>
                <Form.Item style={{ marginTop: 12, marginBottom: 0 }}>
                  <InputNumber
                    value={draft.opening ?? undefined}
                    onChange={(v) => onChange({ opening: v, openingTouched: true })}
                    step={0.01}
                    style={{ width: 200 }}
                    aria-label="الرصيد الافتتاحي"
                    placeholder="دائن"
                  />
                </Form.Item>
              </>
            )}
          </div>
        )}
      </Form>

      {conflict && (
        <Alert
          type="warning"
          showIcon
          message={`توجد جلسة غير مغلقة لنفس الحساب والفترة (#${conflict.id})`}
          description={
            <Space direction="vertical" size={4}>
              <Typography.Text type="secondary">
                يُفضّل إكمال الجلسة القائمة بدل إنشاء جلسة مكررة.
              </Typography.Text>
              <Button size="small" onClick={onGoToExisting}>
                الانتقال إلى قائمة الجلسات
              </Button>
            </Space>
          }
          style={{ marginTop: 16 }}
        />
      )}

      {!canProceed && (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
          أكمل الحقول المطلوبة لتفعيل «التالي»
        </Typography.Text>
      )}
    </div>
  );
}

/** قيمة الفترة الافتراضية للعرض التجريبي */
export const DEFAULT_PERIOD: Dayjs = dayjs('2026-08');
