import { LockOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { App, Avatar, Button, Form, Input, Modal, Popconfirm, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useAuth } from '@/app/AuthContext';
import { api, ApiError } from '@/shared/api/client';
import { ROLE_LABELS } from '@/features/auth/mockUsers';
import { ROLE_DESCRIPTIONS } from './settingsClient';
import type { ManagedUser } from './settingsClient';
import type { UserRoleName } from '@/features/auth/roles';

/**
 * تبويب المستخدمين — Admin فقط (مصفوفة الصلاحيات Stage 1 §4).
 * متصل بالخادم: GET/POST /api/v1/users + deactivate/activate/force-password-change.
 */

interface NewUserValues {
  fullName: string;
  username: string;
  initialPassword: string;
}

export function UsersTab({
  users,
  loading,
  onRefresh,
}: {
  users: ManagedUser[];
  loading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const { user: currentUser } = useAuth();
  const [newOpen, setNewOpen] = useState(false);
  const [newRole, setNewRole] = useState<UserRoleName>('reconciler');
  const [form] = Form.useForm<NewUserValues>();

  const addUser = async () => {
    const values = await form.validateFields();
    try {
      const { user } = await api.post<{ user: ManagedUser }>('/api/v1/users', {
        fullName: values.fullName.trim(),
        username: values.username.trim().toLowerCase(),
        role: newRole,
        initialPassword: values.initialPassword,
      });
      await onRefresh();
      setNewOpen(false);
      form.resetFields();
      setNewRole('reconciler');
      message.success(`أُنشئ الحساب «${user.username}» — سيُطلب منه تغيير كلمة المرور عند أول دخول`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'USERNAME_TAKEN') {
        form.setFields([{ name: 'username', errors: ['اسم المستخدم مستخدم مسبقاً'] }]);
      } else if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        const details = err.details as Array<{ field: string; messageAr: string }>;
        const byField = new Map(details.map((d) => [d.field, d.messageAr]));
        form.setFields([
          { name: 'fullName', errors: byField.get('fullName') ? [byField.get('fullName')!] : [] },
          { name: 'username', errors: byField.get('username') ? [byField.get('username')!] : [] },
          { name: 'initialPassword', errors: byField.get('initialPassword') ? [byField.get('initialPassword')!] : [] },
        ]);
      } else {
        message.error(err instanceof Error ? err.message : 'فشل إنشاء المستخدم');
      }
    }
  };

  const deactivate = async (u: ManagedUser) => {
    try {
      await api.post(`/api/v1/users/${u.id}/deactivate`);
      await onRefresh();
      message.success(`عُطّل حساب «${u.username}» — جلساته الحالية تُبطل فوراً`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'فشل التعطيل');
    }
  };

  const activate = async (u: ManagedUser) => {
    try {
      await api.post(`/api/v1/users/${u.id}/activate`);
      await onRefresh();
      message.success(`أُعيد تفعيل «${u.username}»`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'فشل التفعيل');
    }
  };

  const forceChange = async (u: ManagedUser) => {
    try {
      await api.post(`/api/v1/users/${u.id}/force-password-change`);
      await onRefresh();
      message.success(`سيُطلب من «${u.fullName}» تغيير كلمة المرور عند الدخول القادم`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'فشل الإجراء');
    }
  };

  const columns: ColumnsType<ManagedUser> = [
    {
      title: 'المستخدم',
      dataIndex: 'fullName',
      key: 'name',
      render: (name: string, u) => (
        <span className="user-cell">
          <Avatar size={26} style={{ backgroundColor: 'var(--color-primary)' }}>
            {name.charAt(0)}
          </Avatar>
          <span>
            <strong>{name}</strong>
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
              @{u.username}
            </Typography.Text>
          </span>
        </span>
      ),
    },
    {
      title: 'الدور',
      dataIndex: 'role',
      key: 'role',
      width: 150,
      render: (r: UserRoleName) => (
        <span title={ROLE_DESCRIPTIONS[r]}>
          <Tag color={r === 'admin' ? 'blue' : r === 'reconciler' ? 'green' : 'default'}>
            {ROLE_LABELS[r]}
          </Tag>
        </span>
      ),
    },
    {
      title: 'الحالة',
      dataIndex: 'isActive',
      key: 'active',
      width: 95,
      render: (active: boolean) => (active ? <Tag color="success">نشط</Tag> : <Tag>معطل</Tag>),
    },
    {
      title: 'كلمة المرور',
      dataIndex: 'mustChangePassword',
      key: 'pw',
      width: 150,
      render: (must: boolean) =>
        must ? (
          <Tag color="warning">مؤقتة — تتطلب تغييراً</Tag>
        ) : (
          <Typography.Text type="secondary">عادية</Typography.Text>
        ),
    },
    {
      title: 'إجراءات',
      key: 'actions',
      width: 230,
      render: (_, u) => {
        const isSelf = currentUser?.id === u.id;
        return (
          <span className="user-actions">
            {u.isActive ? (
              <Popconfirm
                title={`تعطيل «${u.username}»؟`}
                description="لن يستطيع الدخول وتُبطل جلسته الحالية."
                okText="تعطيل"
                okButtonProps={{ danger: true }}
                cancelText="إلغاء"
                disabled={isSelf}
                onConfirm={() => deactivate(u)}
              >
                <Button size="small" danger ghost disabled={isSelf} icon={<StopOutlined aria-hidden="true" />}>
                  {isSelf ? 'حسابك' : 'تعطيل'}
                </Button>
              </Popconfirm>
            ) : (
              <Button size="small" onClick={() => activate(u)}>
                تفعيل
              </Button>
            )}
            <Button
              size="small"
              disabled={!u.isActive || u.mustChangePassword}
              icon={<LockOutlined aria-hidden="true" />}
              onClick={() => forceChange(u)}
            >
              إجبار تغيير المرور
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <div className="tab-block">
      <div className="tab-toolbar">
        <Button type="primary" icon={<PlusOutlined aria-hidden="true" />} onClick={() => setNewOpen(true)}>
          مستخدم جديد
        </Button>
        <Typography.Text type="secondary" style={{ marginInlineStart: 'auto' }}>
          {users.filter((u) => u.isActive).length} نشط من {users.length} — الحد المتوقع 3–5 مستخدمين (Q1)
        </Typography.Text>
      </div>

      <Table<ManagedUser>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={users}
        loading={loading}
        pagination={false}
      />

      <Modal
        open={newOpen}
        title="إضافة مستخدم جديد"
        okText="إنشاء الحساب"
        cancelText="إلغاء"
        onOk={addUser}
        onCancel={() => setNewOpen(false)}
        destroyOnHidden
        width={520}
      >
        <Form<NewUserValues> form={form} layout="vertical">
          <Form.Item name="fullName" label="الاسم الكامل" rules={[{ required: true, message: 'أدخل الاسم' }]}>
            <Input maxLength={60} placeholder="مثال: سامي المحاسب" />
          </Form.Item>
          <Form.Item
            name="username"
            label="اسم المستخدم (بالإنجليزية)"
            rules={[
              { required: true, message: 'أدخل اسم المستخدم' },
              { pattern: /^[a-zA-Z0-9._-]+$/, message: 'أحرف إنجليزية وأرقام و . _ - فقط' },
            ]}
          >
            <Input dir="ltr" maxLength={30} placeholder="sami.accountant" />
          </Form.Item>

          <Form.Item label="الدور والصلاحيات" required>
            <div className="role-cards" role="radiogroup" aria-label="اختيار الدور">
              {(Object.keys(ROLE_DESCRIPTIONS) as UserRoleName[]).map((role) => (
                <button
                  key={role}
                  type="button"
                  role="radio"
                  aria-checked={newRole === role}
                  className={`role-card ${newRole === role ? 'selected' : ''}`}
                  onClick={() => setNewRole(role)}
                >
                  <span className="role-card-title">{ROLE_LABELS[role]}</span>
                  <span className="role-card-desc">{ROLE_DESCRIPTIONS[role]}</span>
                </button>
              ))}
            </div>
          </Form.Item>

          <Form.Item
            name="initialPassword"
            label="كلمة مرور أولية (سيُجبَر على تغييرها أول دخول)"
            rules={[
              { required: true, message: 'أدخل كلمة مرور أولية' },
              { min: 8, message: '8 أحرف على الأقل' },
            ]}
            extra="تُخزَّن مشفَّرة (Argon2id) في الخادم — لا يراها أحد غير صاحبها"
          >
            <Input.Password dir="ltr" autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
