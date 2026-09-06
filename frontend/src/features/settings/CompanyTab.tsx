import { DeleteOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons';
import { App, Button, Form, Input, Radio, Space, Tag, Typography, Upload } from 'antd';
import { useState } from 'react';

import { CurrencyBadge } from '@/shared/components/CurrencyBadge';
import { companyLogoUrl, removeCompanyLogo, uploadCompanyLogo } from './settingsClient';
import type { CompanySettings } from './settingsClient';

/**
 * تبويب بيانات الشركة والعملات — ترويسة التقارير (FR-8.1) + ترتيب العملات + شكل الأرقام.
 * الحفظ حالياً محلي (معاينة) — يُثبت في قاعدة الإعدادات عند ربط الخادم.
 */

interface CompanyFormValues {
  nameAr: string;
  nameEn: string;
  address: string;
  phone: string;
  email: string;
}

export function CompanyTab({
  settings,
  onUpdate,
  onLogoUpdated,
}: {
  settings: CompanySettings;
  onUpdate: (patch: Partial<CompanySettings>) => void;
  /** الشعار حفظه الخادم فعلاً — نحدّث الحالة فقط بلا إعادة حفظ كامل (جذر «فشل الحفظ») */
  onLogoUpdated: (company: CompanySettings) => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<CompanyFormValues>();
  const [logoBusy, setLogoBusy] = useState(false);

  /** رفع الشعار فعلياً إلى الخادم (M9) — مع فحص الصيغة والحجم قبل الإرسال */
  const doUploadLogo = (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type)) {
      message.error('صيغة غير مدعومة — المسموح PNG أو JPG أو SVG (يفضَّل PNG بخلفية شفافة)');
      return;
    }
    if (file.size > 300 * 1024) {
      message.error('الشعار أكبر من 300KB — صغّره ثم أعد المحاولة');
      return;
    }
    setLogoBusy(true);
    uploadCompanyLogo(file)
      .then(({ company }) => {
        onLogoUpdated(company);
        message.success('رُفع الشعار — سيظهر في ترويسة التقارير فوراً');
      })
      .catch((e: { messageAr?: string; message?: string }) => message.error(e?.messageAr ?? 'تعذر رفع الشعار'))
      .finally(() => setLogoBusy(false));
  };

  const doRemoveLogo = () => {
    setLogoBusy(true);
    removeCompanyLogo()
      .then(({ company }) => {
        onLogoUpdated(company);
        message.success('أُزيل الشعار');
      })
      .catch((e: { messageAr?: string; message?: string }) => message.error(e?.messageAr ?? 'تعذر الإزالة'))
      .finally(() => setLogoBusy(false));
  };

  const save = (values: CompanyFormValues) => {
    // الحفظ عبر الخادم — رسالة النجاح تصدر من الصفحة الأم بعد تأكيد الحفظ فعلاً
    onUpdate(values);
  };

  const moveCurrency = (code: 'YER' | 'USD' | 'SAR', dir: -1 | 1) => {
    const order = [...settings.currencyOrder];
    const idx = order.indexOf(code);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= order.length) return;
    [order[idx], order[target]] = [order[target], order[idx]];
    onUpdate({ currencyOrder: order });
  };

  return (
    <div className="company-tab">
      <Form<CompanyFormValues>
        form={form}
        layout="vertical"
        initialValues={{
          nameAr: settings.nameAr,
          nameEn: settings.nameEn,
          address: settings.address,
          phone: settings.phone,
          email: settings.email,
        }}
        onFinish={save}
      >
        <div className="company-grid">
          <Form.Item name="nameAr" label="اسم الشركة (عربي)" rules={[{ required: true, message: 'إلزامي للتقارير' }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="nameEn" label="الاسم (إنجليزي)">
            <Input dir="ltr" maxLength={120} />
          </Form.Item>
          <Form.Item name="address" label="العنوان">
            <Input maxLength={160} />
          </Form.Item>
          <Form.Item name="phone" label="هاتف">
            <Input dir="ltr" maxLength={30} className="financial-numbers" />
          </Form.Item>
          <Form.Item name="email" label="بريد التواصل">
            <Input dir="ltr" maxLength={80} />
          </Form.Item>
          <Form.Item label="شعار الشركة (يظهر بالترويسة والتقارير)">
            <Space wrap size={8}>
              {settings.logoFileName && (
                <img
                  src={companyLogoUrl(settings.logoFileName) ?? undefined}
                  alt="شعار الشركة"
                  style={{ height: 40, maxWidth: 160, objectFit: 'contain' }}
                />
              )}
              <Upload
                accept="image/png,image/jpeg,image/svg+xml"
                showUploadList={false}
                maxCount={1}
                disabled={logoBusy}
                beforeUpload={(file) => {
                  doUploadLogo(file);
                  return false; // الرفع اليدوي عبر settingsClient
                }}
              >
                <Button icon={settings.logoFileName ? <PictureOutlined aria-hidden="true" /> : <UploadOutlined aria-hidden="true" />} loading={logoBusy}>
                  {settings.logoFileName ? 'تغيير الشعار…' : 'رفع شعار (PNG/JPG/SVG حتى 300KB)'}
                </Button>
              </Upload>
              {settings.logoFileName && (
                <Button danger icon={<DeleteOutlined aria-hidden="true" />} disabled={logoBusy} onClick={doRemoveLogo}>
                  إزالة
                </Button>
              )}
            </Space>
          </Form.Item>
        </div>
        <Button type="primary" htmlType="submit">
          حفظ بيانات الشركة
        </Button>
      </Form>

      <div className="company-subsection">
        <h4>ترتيب عرض العملات في النظام</h4>
        <ul className="currency-order-list">
          {settings.currencyOrder.map((code, i) => (
            <li key={code}>
              <span className="financial-numbers">{i + 1}.</span>
              <CurrencyBadge currency={code} />
              {i > 0 && (
                <Button size="small" onClick={() => moveCurrency(code, -1)} aria-label={`رفع ${code}`}>
                  ↑
                </Button>
              )}
              {i < settings.currencyOrder.length - 1 && (
                <Button size="small" onClick={() => moveCurrency(code, 1)} aria-label={`تنزيل ${code}`}>
                  ↓
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          لكل عملة كشف مستقل (Q11) — الترتيب تحديد جمالي للقوائم والبطاقات فقط.
        </Typography.Text>
      </div>

      <div className="company-subsection">
        <h4>شكل الأرقام</h4>
        <Radio.Group
          value={settings.numerals}
          onChange={(e) => onUpdate({ numerals: e.target.value })}
          aria-label="شكل الأرقام"
        >
          <Radio.Button value="latin">0123456789 (الأوضح محاسبياً)</Radio.Button>
          <Radio.Button value="arabic_indic">٠١٢٣٤٥٦٧٨٩</Radio.Button>
        </Radio.Group>{' '}
        {settings.numerals === 'latin' ? (
          <Tag color="processing">المعتمد حالياً</Tag>
        ) : (
          <Tag color="warning">التجريبي — يطبق شاملاً عند ربط الخادم</Tag>
        )}
      </div>
    </div>
  );
}
