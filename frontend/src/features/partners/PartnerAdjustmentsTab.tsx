import { PlusOutlined } from '@ant-design/icons';
import { App, Button, DatePicker, Form, Input, InputNumber, Select, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { CurrencyBadge } from '@/shared/components/CurrencyBadge';
import { ADJUSTMENT_TYPE_LABELS } from './partnersLabels';
import { addAdjustment, listAdjustments } from './partnersApi';
import type { AdjustmentType, NotifiedAdjustment, PartnerAccount } from '@/shared/types';

/**
 * تبويب التسويات المبلَّغة (Q9) — متصل بالخادم:
 * GET/POST /api/v1/accounts/{id}/notified-adjustments
 * توثيق ما أبلغناه للمورد (خصم/مرتجع/أخرى) ليرتبط تلقائياً بالفروق المطابقة له لاحقاً.
 */

interface PartnerAdjustmentsTabProps {
  account: PartnerAccount;
  canWrite: boolean;
}

export function PartnerAdjustmentsTab({ account, canWrite }: PartnerAdjustmentsTabProps) {
  const { message } = App.useApp();
  const [entries, setEntries] = useState<NotifiedAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{
    adjustmentDate: { format: (f: string) => string };
    adjustmentType: AdjustmentType;
    amount: number;
    note?: string;
  }>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await listAdjustments(account.accountId));
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'فشل تحميل التسويات');
    } finally {
      setLoading(false);
    }
  }, [account.accountId, message]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await addAdjustment(account.accountId, {
        adjustmentDate: values.adjustmentDate.format('YYYY-MM-DD'),
        adjustmentType: values.adjustmentType,
        amount: values.amount,
        currencyCode: account.currency,
        note: values.note?.trim() || undefined,
      });
      await refresh();
      setAddOpen(false);
      form.resetFields();
      message.success('وُثّقت التسوية المبلَّغة — عند المطابقة ستُقترح تلقائياً كسبب لأي فرق مطابق لها');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'فشل حفظ التسوية');
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<NotifiedAdjustment> = [
    {
      title: 'التاريخ',
      dataIndex: 'dateLabel',
      key: 'date',
      width: 110,
      render: (v: string) => <span className="financial-numbers" style={{ fontSize: 12 }}>{v}</span>,
    },
    {
      title: 'النوع',
      dataIndex: 'type',
      key: 'type',
      width: 90,
      render: (t: AdjustmentType) => (
        <Tag color={t === 'discount' ? 'warning' : t === 'return' ? 'purple' : 'default'}>
          {ADJUSTMENT_TYPE_LABELS[t]}
        </Tag>
      ),
    },
    {
      title: 'المبلغ',
      dataIndex: 'amount',
      key: 'amount',
      width: 150,
      render: (v: number, row) => (
        <span className="financial-numbers">
          {v.toLocaleString('en-US')} <CurrencyBadge currency={row.currency} />
        </span>
      ),
    },
    { title: 'الملاحظة', dataIndex: 'note', key: 'note', ellipsis: true },
  ];

  return (
    <div>
      <div className="tab-toolbar" style={{ marginBottom: 12 }}>
        {canWrite && (
          <Button type="primary" icon={<PlusOutlined aria-hidden="true" />} onClick={() => setAddOpen((v) => !v)}>
            تسوية جديدة
          </Button>
        )}
        <Typography.Text type="secondary" style={{ marginInlineStart: 'auto' }}>
          {entries.length} تسوية موثقة لحساب {account.currency}
        </Typography.Text>
      </div>

      <Table<NotifiedAdjustment>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={entries}
        loading={loading}
        pagination={false}
        locale={{
          emptyText: (
            <Typography.Text type="secondary">
              لا تسويات موثقة لحساب {account.currency} — وثّق الخصومات والمرتجعات التي أبلغتَها للمورد
            </Typography.Text>
          ),
        }}
      />

      {addOpen && (
        <Form form={form} layout="vertical" component="div" style={{ marginTop: 12 }}>
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            تسوية مبلَّغة جديدة — عملة {account.currency}
          </Typography.Title>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            <Form.Item
              name="adjustmentDate"
              label="التاريخ"
              rules={[{ required: true, message: 'اختر التاريخ' }]}
            >
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item name="adjustmentType" label="النوع" initialValue="discount" rules={[{ required: true }]}>
              <Select
                options={Object.entries(ADJUSTMENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Form.Item>
            <Form.Item
              name="amount"
              label="المبلغ"
              rules={[
                { required: true, message: 'أدخل المبلغ' },
                { type: 'number', min: 0.0001, message: 'مبلغ موجب' },
              ]}
            >
              <InputNumber
                min={0.0001}
                style={{ width: '100%' }}
                addonAfter={<CurrencyBadge currency={account.currency} />}
              />
            </Form.Item>
          </div>
          <Form.Item name="note" label="الملاحظة (رقم الإشعار، سبب التسوية…)">
            <Input.TextArea rows={2} maxLength={300} placeholder="مثال: خصم بموجب إشعار رقم 119" />
          </Form.Item>
          <div className="tab-toolbar">
            <Button type="primary" loading={saving} onClick={save}>
              حفظ التسوية
            </Button>
            <Button onClick={() => setAddOpen(false)}>إلغاء</Button>
          </div>
        </Form>
      )}
    </div>
  );
}
