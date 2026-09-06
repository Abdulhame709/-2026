import { LockOutlined } from '@ant-design/icons';
import { App, Form, Input, Modal, Typography } from 'antd';
import { useState } from 'react';
import { useAuth } from '@/app/AuthContext';
import { changePassword } from './authService';
import { ApiError } from '@/shared/api/client';

/**
 * نافذة تغيير كلمة المرور — POST /api/v1/auth/change-password (FR-1.4).
 * تُفتح من قائمة المستخدم بالترويسة، ومن تنبيه «كلمة المرور المؤقتة».
 */
interface Values {
  currentPassword: string;
  newPassword: string;
  confirm: string;
}

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const { refreshUser } = useAuth();
  const [form] = Form.useForm<Values>();
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      await refreshUser();
      message.success('تغيرت كلمة المرور بنجاح — لن يُطلب منك تغييرها مجدداً');
      form.resetFields();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'WRONG_PASSWORD') {
        form.setFields([
          { name: 'currentPassword', errors: ['كلمة المرور الحالية غير صحيحة'] },
        ]);
      } else if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        const details = err.details as Array<{ field: string; messageAr: string }> | undefined;
        const byField = new Map((details ?? []).map((d) => [d.field, d.messageAr]));
        form.setFields([
          { name: 'newPassword', errors: [byField.get('newPassword') ?? err.message] },
        ]);
      } else {
        message.error(err instanceof Error ? err.message : 'فشل تغيير كلمة المرور');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        <span>
          <LockOutlined aria-hidden="true" /> تغيير كلمة المرور
        </span>
      }
      okText="حفظ كلمة المرور"
      cancelText="إلغاء"
      confirmLoading={saving}
      onOk={submit}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      destroyOnHidden
      width={440}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        8 أحرف على الأقل، وتحتوي حرفاً ورقماً، وتختلف عن الحالية.
      </Typography.Paragraph>
      <Form<Values> form={form} layout="vertical">
        <Form.Item name="currentPassword" label="كلمة المرور الحالية" rules={[{ required: true, message: 'أدخل كلمة المرور الحالية' }]}>
          <Input.Password dir="ltr" autoComplete="current-password" />
        </Form.Item>
        <Form.Item name="newPassword" label="كلمة المرور الجديدة" rules={[{ required: true, message: 'أدخل كلمة المرور الجديدة' }]}>
          <Input.Password dir="ltr" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="تأكيد الجديدة"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: 'أعد كتابة الجديدة' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                return !value || getFieldValue('newPassword') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error('غير مطابقة للجديدة'));
              },
            }),
          ]}
        >
          <Input.Password dir="ltr" autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
