import { CalendarOutlined, EditOutlined, FileTextOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { App, Button, Card, Checkbox, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Table, Tabs, Tag, Timeline, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CurrencyBadge } from '@/shared/components/CurrencyBadge';
import { SessionStatusTag } from '@/shared/components/StatusTags';
import { listSessions } from '@/features/sessions/sessionsClient';
import type { SessionListItem } from '@/features/sessions/sessionsClient';
import { api } from '@/shared/api/client';
import { RULE_LABELS, SUPPORTED_CURRENCIES } from './partnersLabels';
import { createAccount, listTemplates, updateMatchingSettings, updatePartner } from './partnersApi';
import { PartnerRefMapTab } from './PartnerRefMapTab';
import { PartnerAdjustmentsTab } from './PartnerAdjustmentsTab';
import type { ImportTemplateRef, Partner, PartnerAccount } from '@/shared/types';

/**
 * تفاصيل الطرف بتبويباته الست — متصلة بالخادم:
 * أساسيات (تعديل/تعطيل) · حسابات العملات (إضافة + إعدادات مطابقة) ·
 * قوالب الاستيراد · خريطة المراجع · تسويات مبلَّغة — كلها بحساب العملة المحدد.
 * سجل المطابقات بيانات معاينة حتى ربط وحدة الجلسات (Module 4).
 */

interface PartnerDetailTabsProps {
  partner: Partner;
  canWrite: boolean;
  onPatch: (patch: Partial<Partner>) => void;
  onChanged: () => Promise<void>;
}

interface EditValues {
  nameAr: string;
  nameEn?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

interface NewAccountValues {
  currencyCode: string;
  ourLedgerCode?: string;
  dateWindowDays: number;
}

export function PartnerDetailTabs({ partner, canWrite, onPatch, onChanged }: PartnerDetailTabsProps) {
  const navigate = useNavigate();
  const { message } = App.useApp();

  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm<EditValues>();
  const [savingEdit, setSavingEdit] = useState(false);

  const [accountOpen, setAccountOpen] = useState(false);
  const [accountForm] = Form.useForm<NewAccountValues>();

  const [settingsAccount, setSettingsAccount] = useState<PartnerAccount | null>(null);

  // العملة المحددة للتبويبات الفرعية (خريطة/تسويات/قوالب)
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(
    partner.accounts[0]?.accountId ?? null,
  );
  useEffect(() => {
    if (!partner.accounts.some((a) => a.accountId === selectedAccountId)) {
      setSelectedAccountId(partner.accounts[0]?.accountId ?? null);
    }
  }, [partner.accounts, selectedAccountId]);
  const selectedAccount = partner.accounts.find((a) => a.accountId === selectedAccountId) ?? null;

  const saveEdit = async () => {
    const values = await editForm.validateFields();
    setSavingEdit(true);
    try {
      const updated = await updatePartner(partner.id, {
        nameAr: values.nameAr.trim(),
        nameEn: values.nameEn?.trim() || null,
        phone: values.phone?.trim() || null,
        email: values.email?.trim() || null,
        notes: values.notes?.trim() || null,
      });
      onPatch({
        nameAr: updated.nameAr,
        nameEn: updated.nameEn,
        phone: updated.phone,
        email: updated.email,
        notes: updated.notes,
      });
      setEditOpen(false);
      message.success('حُفظت تعديلات بيانات المورد');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'فشل الحفظ');
    } finally {
      setSavingEdit(false);
    }
  };

  const toggleActive = async () => {
    try {
      const updated = await updatePartner(partner.id, { isActive: !partner.isActive });
      onPatch({ isActive: updated.isActive });
      await onChanged();
      message.success(updated.isActive ? `أُعيد تفعيل «${partner.nameAr}»` : `عُطّل «${partner.nameAr}» — يمنع الجديد فقط وتاريخه كامل`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'فشل التغيير');
    }
  };

  const addAccount = async () => {
    const values = await accountForm.validateFields();
    try {
      const created = await createAccount(partner.id, {
        currencyCode: values.currencyCode,
        ourLedgerCode: values.ourLedgerCode?.trim() || undefined,
        dateWindowDays: values.dateWindowDays,
      });
      onPatch({ accounts: [...partner.accounts, created] });
      setAccountOpen(false);
      accountForm.resetFields();
      message.success(`أُضيف حساب ${created.currency} — عدّل إعدادات مطابقته من بطاقته`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل إضافة الحساب';
      message.error(msg.includes('بنفس العملة') ? 'هذا المورد لديه حساب بنفس العملة مسبقاً' : msg);
    }
  };

  // سجل جلسات المورد — حقيقي من الخادم (Module 4)
  const [partnerSessions, setPartnerSessions] = useState<SessionListItem[]>([]);
  useEffect(() => {
    let alive = true;
    listSessions()
      .then((all) => {
        if (alive) setPartnerSessions(all.filter((s) => s.partner.nameAr === partner.nameAr));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [partner.nameAr]);

  const historyItems = useMemo(
    () =>
      partnerSessions.map((s) => ({
        color: s.status === 'closed' ? 'green' : s.status === 'reopened' ? 'orange' : 'blue',
        children: (
          <span className="history-item">
            <strong className="financial-numbers">{s.periodLabel}</strong>
            <SessionStatusTag status={s.status} />
            <span className="financial-numbers">
              {s.progress.theirs.lineCount + s.progress.ours.lineCount > 0
                ? `مطابقة ${Math.round(s.progress.matchRatePct)}%`
                : 'لم تُشغَّل'}
            </span>
            {s.progress.ours.leftoverCount + s.progress.theirs.leftoverCount > 0 && (
              <span className="financial-numbers disc-open">
                {s.progress.ours.leftoverCount + s.progress.theirs.leftoverCount} بنود متبقية
              </span>
            )}
          </span>
        ),
      })),
    [partner.nameAr],
  );

  const accountSegmented =
    partner.accounts.length > 1 ? (
      <Segmented
        style={{ marginBottom: 12 }}
        value={selectedAccountId ?? undefined}
        onChange={(v) => setSelectedAccountId(Number(v))}
        options={partner.accounts.map((a) => ({ label: a.currency, value: a.accountId }))}
      />
    ) : null;

  const tabItems = [
    {
      key: 'info',
      label: 'البيانات الأساسية',
      children: (
        <div className="tab-block">
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="الرمز">
              <code className="ref-code">{partner.code}</code>
            </Descriptions.Item>
            <Descriptions.Item label="الحالة">
              {partner.isActive ? <Tag color="success">نشط</Tag> : <Tag>موقوف</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="الاسم العربي">{partner.nameAr}</Descriptions.Item>
            <Descriptions.Item label="الاسم الإنجليزي">
              {partner.nameEn ?? <Typography.Text type="secondary">—</Typography.Text>}
            </Descriptions.Item>
            <Descriptions.Item label="الهاتف">
              {partner.phone ?? <Typography.Text type="secondary">—</Typography.Text>}
            </Descriptions.Item>
            <Descriptions.Item label="البريد">
              {partner.email ?? <Typography.Text type="secondary">—</Typography.Text>}
            </Descriptions.Item>
            <Descriptions.Item label="ملاحظات" span={2}>
              {partner.notes ?? <Typography.Text type="secondary">—</Typography.Text>}
            </Descriptions.Item>
          </Descriptions>
          {canWrite && (
            <div className="tab-toolbar" style={{ marginTop: 12 }}>
              <Button
                icon={<EditOutlined aria-hidden="true" />}
                onClick={() => {
                  editForm.setFieldsValue({
                    nameAr: partner.nameAr,
                    nameEn: partner.nameEn,
                    phone: partner.phone,
                    email: partner.email,
                    notes: partner.notes,
                  });
                  setEditOpen(true);
                }}
              >
                تعديل البيانات
              </Button>
              {partner.isActive ? (
                <Popconfirm
                  title={`تعطيل «${partner.nameAr}»؟`}
                  description="يمنع الجلسات والعمليات الجديدة فقط — تاريخه وكشوفه تبقى كاملة."
                  okText="تعطيل"
                  okButtonProps={{ danger: true }}
                  cancelText="إلغاء"
                  onConfirm={toggleActive}
                >
                  <Button danger>تعطيل المورد</Button>
                </Popconfirm>
              ) : (
                <Button type="primary" ghost onClick={toggleActive}>
                  إعادة التفعيل
                </Button>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'accounts',
      label: `الحسابات (${partner.accounts.length} ${partner.accounts.length === 1 ? 'عملة' : 'عملات'})`,
      children: (
        <div className="tab-block">
          <div className="accounts-grid">
            {partner.accounts.map((acc) => (
              <Card
                key={acc.accountId}
                size="small"
                title={
                  <span className="acc-card-title">
                    <CurrencyBadge currency={acc.currency} />
                    حساب {acc.currency}
                  </span>
                }
                extra={
                  <span>
                    {canWrite && (
                      <Button
                        size="small"
                        icon={<SettingOutlined aria-hidden="true" />}
                        onClick={() => setSettingsAccount(acc)}
                        style={{ marginInlineEnd: 4 }}
                      >
                        الإعدادات
                      </Button>
                    )}
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      icon={<CalendarOutlined aria-hidden="true" />}
                      onClick={() =>
                        navigate(`/sessions/new?partner=${encodeURIComponent(partner.nameAr)}&currency=${acc.currency}`)
                      }
                    >
                      جلسة جديدة
                    </Button>
                  </span>
                }
              >
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="حسابنا المحاسبي">
                    <code className="ref-code financial-numbers">{acc.ledgerCode}</code>
                  </Descriptions.Item>
                  <Descriptions.Item label="تقارب التاريخ (إرشادي)">
                    <span className="financial-numbers">±{acc.dateWindowDays} يوماً</span>
                    <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                      للترتيب فقط — القيد المتأخر أسابيع يُطابق عادي
                    </Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="ترتيب قواعد المطابقة">
                    <span className="rule-tags">
                      {acc.ruleOrder.map((r, i) => (
                        <Tag key={r} style={{ marginInlineEnd: 4 }}>
                          <span className="financial-numbers">{i + 1}.</span> {RULE_LABELS[r] ?? r}
                        </Tag>
                      ))}
                    </span>
                  </Descriptions.Item>
                  <Descriptions.Item label="آخر جلسة">
                    <Typography.Text type="secondary">تظهر بعد أول جلسة مطابقة (الوحدة 4)</Typography.Text>
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            ))}
          </div>
          {partner.accounts.length === 0 && (
            <Typography.Text type="secondary">
              لا حسابات معرفة — {canWrite ? 'أضف أول حساب بالزر أدناه' : 'يضيفها المدير أو المحاسب المطابق'}
            </Typography.Text>
          )}
          {canWrite && (
            <div className="tab-toolbar" style={{ marginTop: 12 }}>
              <Button
                type="primary"
                ghost
                icon={<PlusOutlined aria-hidden="true" />}
                onClick={() => setAccountOpen(true)}
              >
                حساب بعملة جديدة
              </Button>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'templates',
      label: 'قوالب الاستيراد',
      children: (
        <div className="tab-block">
          {accountSegmented}
          {selectedAccount ? (
            <TemplatesTab accountId={selectedAccount.accountId} canWrite={canWrite} />
          ) : (
            <Typography.Text type="secondary">أضف حساباً بعملة أولاً — القوالب تُربط بالحساب</Typography.Text>
          )}
        </div>
      ),
    },
    {
      key: 'refmap',
      label: 'خريطة المراجع',
      children: (
        <div className="tab-block">
          {accountSegmented}
          {selectedAccount ? (
            <PartnerRefMapTab account={selectedAccount} canWrite={canWrite} />
          ) : (
            <Typography.Text type="secondary">أضف حساباً بعملة أولاً</Typography.Text>
          )}
        </div>
      ),
    },
    {
      key: 'adjustments',
      label: (
        <span>
          التسويات المبلَّغة
        </span>
      ),
      children: (
        <div className="tab-block">
          {accountSegmented}
          {selectedAccount ? (
            <PartnerAdjustmentsTab account={selectedAccount} canWrite={canWrite} />
          ) : (
            <Typography.Text type="secondary">أضف حساباً بعملة أولاً</Typography.Text>
          )}
        </div>
      ),
    },
    {
      key: 'history',
      label: 'سجل المطابقات',
      children: (
        <div className="tab-block">
          {historyItems.length > 0 ? (
            <>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                بيانات معاينة — تُربط بالجلسات الحقيقية في الوحدة 4
              </Typography.Text>
              <Timeline items={historyItems} />
            </>
          ) : (
            <Typography.Text type="secondary">
              لا جلسات سابقة — ابدأ أول جلسة من تبويب «الحسابات»
            </Typography.Text>
          )}
          <div>
            <Button
              type="link"
              icon={<FileTextOutlined aria-hidden="true" />}
              onClick={() => navigate('/reports')}
            >
              فتح الأرشيف التاريخي الكامل
            </Button>
          </div>
        </div>
      ),
    },
  ];

  const availableCurrencies = SUPPORTED_CURRENCIES.filter(
    (c) => !partner.accounts.some((a) => a.currency === c),
  );

  return (
    <>
    <Tabs defaultActiveKey="info" items={tabItems} type="line" size="small" className="partner-tabs">
    </Tabs>

      {/* نوافذ النموذج — خارج التبويبات لتجنب إلغائها عند تنقّل التبويبات */}
      <Modal
        open={editOpen}
        title={`تعديل بيانات «${partner.nameAr}»`}
        okText="حفظ"
        cancelText="إلغاء"
        confirmLoading={savingEdit}
        onOk={saveEdit}
        onCancel={() => setEditOpen(false)}
        destroyOnHidden
        width={520}
      >
        <Form<EditValues> form={editForm} layout="vertical">
          <Form.Item name="nameAr" label="الاسم العربي" rules={[{ required: true, message: 'الاسم العربي إلزامي' }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="nameEn" label="الاسم الإنجليزي (اختياري)">
            <Input dir="ltr" maxLength={120} />
          </Form.Item>
          <Form.Item name="phone" label="الهاتف (اختياري)">
            <Input dir="ltr" maxLength={30} />
          </Form.Item>
          <Form.Item name="email" label="البريد (اختياري)">
            <Input dir="ltr" maxLength={80} />
          </Form.Item>
          <Form.Item name="notes" label="ملاحظات (اختياري)">
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={accountOpen}
        title={`حساب بعملة جديدة — ${partner.nameAr}`}
        okText="إضافة الحساب"
        cancelText="إلغاء"
        onOk={addAccount}
        onCancel={() => setAccountOpen(false)}
        destroyOnHidden
        width={460}
      >
        <Form<NewAccountValues> form={accountForm} layout="vertical" initialValues={{ dateWindowDays: 3 }}>
          <Form.Item name="currencyCode" label="العملة" rules={[{ required: true, message: 'اختر العملة' }]}>
            <Select
              placeholder={availableCurrencies.length ? 'اختر العملة' : 'كل العملات مضافة لهذا المورد'}
              disabled={availableCurrencies.length === 0}
              options={availableCurrencies.map((c) => ({ value: c, label: c }))}
            />
          </Form.Item>
          <Form.Item name="ourLedgerCode" label="رقم الحساب في نظامنا المحاسبي (اختياري)">
            <Input dir="ltr" placeholder="مثال: 210101005" maxLength={30} className="financial-numbers" />
          </Form.Item>
          <Form.Item
            name="dateWindowDays"
            label="تقارب التاريخ الإرشادي (±أيام)"
            extra="للترتيب عند الاقتراح فقط — ليس شرطاً؛ القيد المتأخر أسابيع يُطابق عادي · الافتراضي 3 · الحد 30"
          >
            <InputNumber min={0} max={30} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <MatchingSettingsModal
        account={settingsAccount}
        onClose={() => setSettingsAccount(null)}
        onSaved={(updated) => {
          onPatch({
            accounts: partner.accounts.map((a) => (a.accountId === updated.accountId ? updated : a)),
          });
          setSettingsAccount(null);
        }}
      />

    </>
  );
}

/** نافذة إعدادات المطابقة: نافذة التاريخ + ترتيب القواعد الأربع (PUT /accounts/{id}/matching-settings) */
function MatchingSettingsModal({
  account,
  onClose,
  onSaved,
}: {
  account: PartnerAccount | null;
  onClose: () => void;
  onSaved: (a: PartnerAccount) => void;
}) {
  const { message } = App.useApp();
  const [windowDays, setWindowDays] = useState(3);
  const [order, setOrder] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (account) {
      setWindowDays(account.dateWindowDays);
      setOrder(account.ruleOrder);
    }
  }, [account]);

  const save = async () => {
    if (!account) return;
    setSaving(true);
    try {
      const updated = await updateMatchingSettings(account.accountId, {
        dateWindowDays: windowDays,
        ruleOrder: order,
      });
      message.success('حُفظت إعدادات المطابقة — ستُطبق في الجلسات القادمة');
      onSaved(updated);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={account !== null}
      title={account ? `إعدادات المطابقة — حساب ${account.currency}` : ''}
      okText="حفظ الإعدادات"
      cancelText="إلغاء"
      confirmLoading={saving}
      onOk={save}
      onCancel={onClose}
      destroyOnHidden
      width={480}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        نافذة التاريخ: أقصى فرق أيام مقبول بين قيدنا وسطر كشفهم لنفس المطابقة.
        ترتيب القواعد: يطبقها المحرك بالتسلسل حتى أول تطابق.
      </Typography.Paragraph>
      <div style={{ marginBottom: 16 }}>
        <Typography.Text strong>نافذة التاريخ (±أيام)</Typography.Text>
        <InputNumber min={0} max={30} value={windowDays} onChange={(v) => setWindowDays(Number(v ?? 3))} style={{ width: '100%', marginTop: 4 }} />
      </div>
      <Typography.Text strong>ترتيب قواعد المطابقة</Typography.Text>
      <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
        {[0, 1, 2, 3].map((idx) => {
          const chosen = order.filter((_, i) => i !== idx);
          return (
            <Select
              key={idx}
              value={order[idx]}
              onChange={(v) => {
                const next = [...order];
                next[idx] = v;
                setOrder(next);
              }}
              options={(['exact_ref', 'ref_map', 'description_ref', 'amount_date'] as const)
                .filter((r) => !chosen.includes(r))
                .map((r) => ({ value: r, label: `${idx + 1}. ${RULE_LABELS[r]}` }))}
              placeholder={`اختر القاعدة رقم ${idx + 1}`}
            />
          );
        })}
      </div>
    </Modal>
  );
}

/** قوالب الاستيراد لحساب محدد — القائمة من الخادم + إنشاء قالب كشوفهم */
function TemplatesTab({ accountId, canWrite }: { accountId: number; canWrite: boolean }) {
  const { message } = App.useApp();
  const [templates, setTemplates] = useState<ImportTemplateRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ name: string; isDefault: boolean }>();

  useEffect(() => {
    let live = true;
    setLoading(true);
    listTemplates(accountId)
      .then((t) => live && setTemplates(t))
      .catch(() => live && message.error('فشل تحميل القوالب'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [accountId, message]);

  const add = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await api.post(`/api/v1/accounts/${accountId}/import-templates`, {
        templateKind: 'theirs',
        name: values.name.trim(),
        headerRows: 1,
        columnsMapping: { date: 'A', ref: 'B', description: 'C', debit: 'D', credit: 'E' },
        isDefault: values.isDefault ?? false,
      });
      setTemplates(await listTemplates(accountId));
      setAddOpen(false);
      form.resetFields();
      message.success('حُفظ القالب — تحرير تعيين الأعمدة التفصيلي في معالج الاستيراد (الوحدة 3)');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'فشل حفظ القالب');
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<ImportTemplateRef> = [
    { title: 'القالب', dataIndex: 'name', key: 'name' },
    {
      title: 'الجهة',
      dataIndex: 'kind',
      key: 'kind',
      width: 160,
      render: (k: ImportTemplateRef['kind']) => (k === 'ours' ? 'كشفنا (نظامنا)' : 'كشف الطرف'),
    },
    {
      title: 'الافتراضي',
      dataIndex: 'isDefault',
      key: 'default',
      width: 100,
      render: (d: boolean) => (d ? <Tag color="success">افتراضي</Tag> : '—'),
    },
  ];

  return (
    <div>
      {canWrite && (
        <div className="tab-toolbar" style={{ marginBottom: 12 }}>
          <Button icon={<PlusOutlined aria-hidden="true" />} onClick={() => setAddOpen(true)}>
            قالب جديد لكشوفهم
          </Button>
          <Typography.Text type="secondary" style={{ marginInlineStart: 'auto', fontSize: 12 }}>
            قالب «كشفنا» المشترك يُدار مركزياً — يعمل مع أي نظام محاسبي
          </Typography.Text>
        </div>
      )}
      <Table<ImportTemplateRef>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={templates}
        loading={loading}
        pagination={false}
        locale={{
          emptyText: (
            <Typography.Text type="secondary">
              لا قوالب بعد — أنشئ أول قالب من معالج الاستيراد عند أول رفع لهذا المورد
            </Typography.Text>
          ),
        }}
      />
      <Modal
        open={addOpen}
        title="قالب استيراد جديد لكشوفهم"
        okText="حفظ القالب"
        cancelText="إلغاء"
        confirmLoading={saving}
        onOk={add}
        onCancel={() => setAddOpen(false)}
        destroyOnHidden
        width={440}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="اسم القالب" rules={[{ required: true, message: 'أدخل اسم القالب' }]}>
            <Input maxLength={80} placeholder="مثال: كشفهم — Excel مبسط" />
          </Form.Item>
          <Form.Item name="isDefault" valuePropName="checked" initialValue={false}>
            <Checkbox>جعله الافتراضي لهذا الحساب</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
