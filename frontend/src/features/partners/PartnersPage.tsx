import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { App, Button, Card, Empty, Form, Input, List, Modal, Spin, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CurrencyBadge } from '@/shared/components/CurrencyBadge';
import { createPartner, listPartners } from './partnersApi';
import { PartnerDetailTabs } from './PartnerDetailTabs';
import type { Partner } from '@/shared/types';

/**
 * الأطراف والحسابات — تخطيط رئيسي–تفصيلي (وثيقة التصميم §3):
 * قائمة موردين يميناً + ملف تفاصيل بتبويباته الست يساراً.
 * متصل بالخادم: GET/POST /api/v1/partners — التفاصيل تدير حساباتها داخل التبويبات.
 */

interface NewPartnerFormValues {
  nameAr: string;
  nameEn?: string;
  code?: string;
  notes?: string;
}

export function PartnersPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [form] = Form.useForm<NewPartnerFormValues>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setPartners(await listPartners());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'فشل تحميل الموردين');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return partners;
    return partners.filter((p) => `${p.nameAr} ${p.nameEn ?? ''} ${p.code}`.includes(q));
  }, [partners, search]);

  const selected = partners.find((p) => String(p.id) === id) ?? null;

  const patchPartner = (pid: number, patch: Partial<Partner>) => {
    setPartners((prev) => prev.map((p) => (p.id === pid ? { ...p, ...patch } : p)));
  };

  const addPartner = async () => {
    const values = await form.validateFields();
    try {
      const created = await createPartner({
        nameAr: values.nameAr.trim(),
        nameEn: values.nameEn?.trim() || undefined,
        code: values.code?.trim() || undefined, // هجين: يُولَّد SUP-nn عند الغياب
        notes: values.notes?.trim() || undefined,
      });
      await refresh();
      setNewOpen(false);
      form.resetFields();
      message.success(
        `أُضيف المورد «${created.nameAr}» برمز ${created.code} — أضف حساباته بالعملات من تبويب الحسابات`,
      );
      navigate(`/partners/${created.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل إضافة المورد';
      if (msg.includes('رمز المورد مستخدم')) {
        form.setFields([{ name: 'code', errors: ['رمز المورد مستخدم مسبقاً'] }]);
      } else {
        message.error(msg);
      }
    }
  };

  return (
    <section aria-label="الأطراف والحسابات" className="partners-page">
      <div className="page-head">
        <Typography.Title level={4} style={{ margin: 0 }}>
          الأطراف والحسابات
        </Typography.Title>
        <Button icon={<ReloadOutlined aria-hidden="true" />} onClick={refresh} loading={loading}>
          تحديث
        </Button>
        <Button type="primary" icon={<PlusOutlined aria-hidden="true" />} onClick={() => setNewOpen(true)}>
          مورد جديد
        </Button>
      </div>

      <div className="partners-layout">
        {/* القائمة — يمين الشاشة في RTL */}
        <Card
          size="small"
          className="partners-list-card"
          title={
            <Input.Search
              placeholder="بحث بالاسم أو الرمز…"
              allowClear
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="بحث في الموردين"
            />
          }
          styles={{ body: { padding: 0 } }}
        >
          {loadError ? (
            <div style={{ padding: 24 }}>
              <Typography.Text type="danger">{loadError}</Typography.Text>
              <Button size="small" style={{ marginInlineStart: 12 }} onClick={refresh}>
                إعادة المحاولة
              </Button>
            </div>
          ) : loading ? (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <Spin />
            </div>
          ) : (
          <List
            dataSource={filtered}
            locale={{
              emptyText: <Typography.Text type="secondary">لا نتائج للبحث</Typography.Text>,
            }}
            renderItem={(p) => {
              const isSelected = selected?.id === p.id;
              return (
                <List.Item
                  className={`partner-list-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => navigate(`/partners/${p.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/partners/${p.id}`);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-current={isSelected || undefined}
                  aria-label={`فتح ملف ${p.nameAr}`}
                >
                  <div className="partner-list-main">
                    <span className="partner-list-name">
                      {p.nameAr} {!p.isActive && <Tag style={{ marginInlineStart: 4 }}>موقوف</Tag>}
                    </span>
                    <span className="partner-list-sub">
                      <code className="ref-code">{p.code}</code>
                      {p.accounts.map((a) => (
                        <CurrencyBadge key={a.currency} currency={a.currency} />
                      ))}
                    </span>
                  </div>
                </List.Item>
              );
            }}
          />
          )}
        </Card>

        {/* التفاصيل — يسار الشاشة */}
        <Card className="partner-detail-card" styles={{ body: { paddingBlock: 8 } }}>
          {selected ? (
            <PartnerDetailTabs
              partner={selected}
              canWrite
              onPatch={(patch) => patchPartner(selected.id, patch)}
              onChanged={refresh}
            />
          ) : (
            <Empty
              description={
                <span>
                  اختر مورداً من القائمة لعرض ملفه
                  <br />
                  <Typography.Text type="secondary">
                    أو أضف مورداً جديداً بالزر أعلى اليمين
                  </Typography.Text>
                </span>
              }
              style={{ padding: 48 }}
            />
          )}
        </Card>
      </div>

      {/* نافذة مورد جديد — حقول قليلة لتشجيع اكتمال البيانات (§3.3) */}
      <Modal
        open={newOpen}
        title="إضافة مورد جديد"
        okText="إضافة"
        cancelText="إلغاء"
        onOk={addPartner}
        onCancel={() => setNewOpen(false)}
        destroyOnHidden
      >
        <Form<NewPartnerFormValues> form={form} layout="vertical">
          <Form.Item
            name="nameAr"
            label="الاسم العربي"
            rules={[{ required: true, message: 'الاسم العربي إلزامي' }]}
          >
            <Input placeholder="مثال: شركة …" maxLength={120} />
          </Form.Item>
          <Form.Item name="nameEn" label="الاسم الإنجليزي (اختياري)">
            <Input dir="ltr" maxLength={120} />
          </Form.Item>
          <Form.Item name="code" label="الرمز (اختياري — يُولّد تلقائياً)">
            <Input dir="ltr" placeholder="SUP-005" maxLength={20} />
          </Form.Item>
          <Form.Item name="notes" label="ملاحظات (اختياري)">
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
