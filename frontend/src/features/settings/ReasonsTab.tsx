import { ArrowDownOutlined, ArrowUpOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Form, Input, Popconfirm, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { addReasonCode, listReasonCodes, reorderReasonCodes, updateReasonCode } from './settingsClient';
import type { ReasonCodeRow } from './settingsClient';

/**
 * تبويب رموز الأسباب — حقيقي (Module 6): القائمة من الخادم، الإضافة تُشتق رمزها
 * آلياً، والتعطيل/الترتيب بالأسهم يُحفظ فوراً (يظهر في درج الفروق وتقارير الموردين).
 */

interface NewReasonValues {
  labelAr: string;
  labelEn: string;
}

export function ReasonsTab({ canManage }: { canManage: boolean }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<NewReasonValues>();
  const [reasons, setReasons] = useState<ReasonCodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    listReasonCodes()
      .then(setReasons)
      .catch(() => message.error('تعذر جلب الأسباب'))
      .finally(() => setLoading(false));
  }, [message]);

  useEffect(load, [load]);

  const addReason = (values: NewReasonValues) => {
    setAdding(true);
    addReasonCode(values.labelAr.trim(), values.labelEn.trim())
      .then(() => {
        message.success('أُضيف السبب — متاح فوراً في درج الفروق');
        form.resetFields();
        load();
      })
      .catch((e: { messageAr?: string; message?: string }) => message.error(e?.messageAr ?? 'فشل الإضافة'))
      .finally(() => setAdding(false));
  };

  const toggle = (r: ReasonCodeRow) => {
    updateReasonCode(r.id, { isActive: !r.isActive })
      .then(() => {
        setReasons((prev) => prev.map((x) => (x.id === r.id ? { ...x, isActive: !x.isActive } : x)));
        message.success(r.isActive ? 'عُطّل السبب — يختفي من قوائم الاختيار الجديدة' : 'فُعّل السبب');
      })
      .catch((e: { messageAr?: string; message?: string }) => message.error(e?.messageAr ?? 'فشل التغيير'));
  };

  const move = (id: number, dir: -1 | 1) => {
    const idx = reasons.findIndex((r) => r.id === id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= reasons.length) return;
    const next = [...reasons];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    setReasons(next);
    reorderReasonCodes(next.map((r) => r.id))
      .catch(() => message.error('تعذر حفظ الترتيب'));
  };

  const columns: ColumnsType<ReasonCodeRow> = [
    {
      title: 'الترتيب',
      key: 'order',
      width: 80,
      render: (_, r, i) =>
        canManage ? (
          <>
            <Button size="small" type="text" icon={<ArrowUpOutlined aria-hidden="true" />} disabled={i === 0} onClick={() => move(r.id, -1)} aria-label={`تحريك ${r.labelAr} لأعلى`} />
            <Button size="small" type="text" icon={<ArrowDownOutlined aria-hidden="true" />} disabled={i === reasons.length - 1} onClick={() => move(r.id, 1)} aria-label={`تحريك ${r.labelAr} لأسفل`} />
          </>
        ) : (
          <span className="financial-numbers">{i + 1}</span>
        ),
    },
    { title: 'السبب (عربي)', dataIndex: 'labelAr', key: 'ar' },
    {
      title: 'السبب (إنجليزي)',
      dataIndex: 'labelEn',
      key: 'en',
      render: (v: string) => <Typography.Text type="secondary">{v}</Typography.Text>,
    },
    { title: 'الرمز', dataIndex: 'code', key: 'code', width: 210, render: (v: string) => <Tag className="financial-numbers">{v}</Tag> },
    {
      title: 'الحالة',
      dataIndex: 'isActive',
      key: 'active',
      width: 130,
      render: (active: boolean) =>
        active ? <Tag color="success">فعّال</Tag> : <Tag>معطل</Tag>,
    },
    ...(canManage
      ? [
          {
            title: '',
            key: 'act',
            width: 110,
            render: (_: unknown, r: ReasonCodeRow) => (
              <Popconfirm
                title={r.isActive ? 'تعطيل هذا السبب؟' : 'تفعيل هذا السبب؟'}
                okText="نعم"
                cancelText="تراجع"
                onConfirm={() => toggle(r)}
              >
                <Button size="small">{r.isActive ? 'تعطيل' : 'تفعيل'}</Button>
              </Popconfirm>
            ),
          } as ColumnsType<ReasonCodeRow>[number],
        ]
      : []),
  ];

  return (
    <div className="reasons-tab">
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        أسباب الفروق الجاهزة — تُعرض للمحاسب عند تحليل أي فرق، وبأسمائها الإنجليزية في
        التقارير المرسلة للموردين (FR-5.2). الترتيب هنا هو ترتيب الظهور.
      </Typography.Paragraph>

      {canManage && (
        <Form<NewReasonValues> form={form} layout="inline" onFinish={addReason} style={{ marginBottom: 16 }}>
          <Form.Item name="labelAr" rules={[{ required: true, message: 'الاسم العربي إلزامي' }]}>
            <Input placeholder="السبب بالعربية…" maxLength={120} aria-label="السبب بالعربية" />
          </Form.Item>
          <Form.Item name="labelEn" rules={[{ required: true, message: 'الاسم الإنجليزي إلزامي (يُشتق منه الرمز)' }]}>
            <Input placeholder="English reason…" maxLength={120} dir="ltr" aria-label="السبب بالإنجليزية" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" icon={<PlusOutlined aria-hidden="true" />} loading={adding} htmlType="submit">
              إضافة سبب
            </Button>
          </Form.Item>
        </Form>
      )}

      <Table<ReasonCodeRow>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={reasons}
        loading={loading}
        pagination={false}
      />
    </div>
  );
}
