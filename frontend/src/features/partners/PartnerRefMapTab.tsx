import { DeleteOutlined, PlusOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { App, Button, Form, Input, Popconfirm, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { addRefMap, deleteRefMap, listRefMap } from './partnersApi';
import type { PartnerAccount, RefMapEntry, RefMapSource } from '@/shared/types';

/**
 * تبويب خريطة المراجع — القلب المعرفي للمطابقة (FR-2.5 / Q8) — متصل بالخادم:
 * GET/POST/DELETE /api/v1/accounts/{id}/ref-map — الإضافة اليدوية فورية.
 * اعتماد المقترحات الآلية يُفعَّل مع محرك المطابقة (Module 4).
 */

const SOURCE_META: Record<RefMapSource, { label: string; color: string }> = {
  manual: { label: 'يدوي', color: 'default' },
  auto_confirmed: { label: 'مؤكد آلياً ✓', color: 'success' },
  auto_suggested: { label: 'مقترح من النظام 💡', color: 'warning' },
};

interface PartnerRefMapTabProps {
  account: PartnerAccount;
  canWrite: boolean;
}

export function PartnerRefMapTab({ account, canWrite }: PartnerRefMapTabProps) {
  const { message } = App.useApp();
  const [entries, setEntries] = useState<RefMapEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ ourRef: string; theirRef: string }>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await listRefMap(account.accountId));
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'فشل تحميل خريطة المراجع');
    } finally {
      setLoading(false);
    }
  }, [account.accountId, message]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addManual = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await addRefMap(account.accountId, { ourRef: values.ourRef.trim(), theirRef: values.theirRef.trim() });
      await refresh();
      form.resetFields();
      setAddOpen(false);
      message.success('أُضيف الارتباط لخريطة المراجع — سيُستخدم في المطابقة القادمة تلقائياً');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'فشل حفظ الارتباط');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry: RefMapEntry) => {
    try {
      await deleteRefMap(account.accountId, entry.id);
      await refresh();
      message.success(`حُذف الارتباط ${entry.ourRef} ↔ ${entry.theirRef}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'فشل الحذف');
    }
  };

  const columns: ColumnsType<RefMapEntry> = [
    {
      title: 'رقمنا (يدوي)',
      dataIndex: 'ourRef',
      key: 'our',
      width: 160,
      render: (v: string) => <code className="ref-code financial-numbers">{v}</code>,
    },
    { title: '↔', key: 'arrow', width: 40, align: 'center' as const, render: () => <span>↔</span> },
    {
      title: 'رقمه (آلي)',
      dataIndex: 'theirRef',
      key: 'their',
      width: 160,
      render: (v: string) => <code className="ref-code financial-numbers">{v}</code>,
    },
    {
      title: 'المصدر',
      dataIndex: 'source',
      key: 'source',
      width: 170,
      render: (s: RefMapSource) => <Tag color={SOURCE_META[s].color}>{SOURCE_META[s].label}</Tag>,
    },
    {
      title: 'أُضيف',
      dataIndex: 'addedLabel',
      key: 'added',
      width: 120,
      render: (v: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {v}
        </Typography.Text>
      ),
    },
    ...(canWrite
      ? [
          {
            title: '',
            key: 'actions',
            width: 60,
            render: (_: unknown, entry: RefMapEntry) => (
              <Popconfirm
                title={`حذف الارتباط ${entry.ourRef} ↔ ${entry.theirRef}؟`}
                description="المطابقات القادمة لن تستخدمه."
                okText="حذف"
                okButtonProps={{ danger: true }}
                cancelText="إلغاء"
                onConfirm={() => remove(entry)}
              >
                <Button size="small" danger ghost icon={<DeleteOutlined aria-hidden="true" />} />
              </Popconfirm>
            ),
          } as ColumnsType<RefMapEntry>[number],
        ]
      : []),
  ];

  const emptyState = useMemo(
    () => (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <QuestionCircleOutlined style={{ fontSize: 28, color: 'var(--color-text-tertiary)' }} />
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
          خريطة المراجع فارغة لحساب {account.currency} — تُبنى تلقائياً من شاشة المطابقة عند تأكيد
          الارتباطات، أو أضف أول ارتباط يدوياً الآن.
        </Typography.Paragraph>
      </div>
    ),
    [account.currency],
  );

  return (
    <div>
      <div className="tab-toolbar" style={{ marginBottom: 12 }}>
        <Tooltip title="تُتاح مع محرك المطابقة (الوحدة 4) — تظهر هنا اقتراحات الارتباطات المكتشفة">
          <Button type="primary" disabled>
            اعتماد المقترحات (0)
          </Button>
        </Tooltip>
        {canWrite && (
          <Button icon={<PlusOutlined aria-hidden="true" />} onClick={() => setAddOpen((v) => !v)}>
            إضافة ارتباط يدوي
          </Button>
        )}
        <Typography.Text type="secondary" style={{ marginInlineStart: 'auto' }}>
          {entries.length} ارتباطاً لحساب {account.currency} — يُستخدم في قاعدة «خريطة المراجع»
        </Typography.Text>
      </div>

      <Table<RefMapEntry>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={entries}
        loading={loading}
        pagination={false}
        locale={{ emptyText: emptyState }}
      />

      {addOpen && (
        <Form form={form} layout="vertical" component="div" className="refmap-modal">
          <Typography.Title level={5} style={{ marginTop: 12 }}>
            إضافة ارتباط مرجعي جديد — حساب {account.currency}
          </Typography.Title>
          <div className="refmap-modal-fields">
            <Form.Item
              name="ourRef"
              label="رقمنا اليدوي"
              rules={[{ required: true, message: 'أدخل الرقم اليدوي كما هو في نظامنا المحاسبي' }]}
            >
              <Input placeholder="مثال: 7030" dir="ltr" className="financial-numbers" />
            </Form.Item>
            <Form.Item
              name="theirRef"
              label="رقمه الآلي"
              rules={[{ required: true, message: 'أدخل الرقم كما يظهر في كشف المورد' }]}
            >
              <Input placeholder="مثال: 5155" dir="ltr" className="financial-numbers" />
            </Form.Item>
          </div>
          <div className="tab-toolbar">
            <Button type="primary" loading={saving} onClick={addManual}>
              حفظ الارتباط
            </Button>
            <Button onClick={() => setAddOpen(false)}>إلغاء</Button>
          </div>
        </Form>
      )}
    </div>
  );
}
