import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BrandLogo } from '@/shared/components/BrandLogo';
import { LanguageSwitch } from '@/shared/components/LanguageSwitch';
import { useAuth } from '@/app/AuthContext';
import { formatRemaining, lockSecondsFrom } from './authService';
import { DEMO_ACCOUNTS, ROLE_LABELS } from './mockUsers';

/**
 * شاشة تسجيل الدخول — وثيقة التصميم stage-2c §1
 * بطاقة مركزية 400px · خطأ موحد · قفل مؤقت بعدّاد · تغيير كلمة مرور إلزامي لاحقاً.
 */

interface LoginFormValues {
  username: string;
  password: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login } = useAuth();

  const [form] = Form.useForm<LoginFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockSeconds, setLockSeconds] = useState(0);
  // انتهت الجلسة أثناء العمل (خمول 12 ساعة) — رسالة واضحة بدل الاصطهاد الصامت
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    const onUnauthorized = (e: Event) => {
      const detail = (e as CustomEvent<{ reason?: string }>).detail;
      if (detail?.reason === 'expired') setSessionExpired(true);
    };
    window.addEventListener('recon:unauthorized', onUnauthorized);
    return () => window.removeEventListener('recon:unauthorized', onUnauthorized);
  }, []);

  // عدّاد القفل التنازلي — يتوقف عند الصفر ويعيد تمكين الزر
  useEffect(() => {
    if (lockSeconds <= 0) return;
    const timer = setInterval(() => setLockSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [lockSeconds]);

  const navigateFrom = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  // مستخدم مسجل مسبقاً؟ ينتقل مباشرة (داخل useEffect — ليس أثناء التصيير)
  useEffect(() => {
    if (user) navigate(navigateFrom, { replace: true });
  }, [user, navigate, navigateFrom]);

  const onFinish = async (values: LoginFormValues) => {
    setError(null);
    setSubmitting(true);
    try {
      await login(values.username, values.password);
      navigate(navigateFrom, { replace: true });
    } catch (err) {
      const seconds = lockSecondsFrom(err);
      if (seconds !== null) {
        setError(`حُظر مؤقتاً — حاول بعد ${formatRemaining(seconds)}`);
        setLockSeconds(seconds);
      } else {
        setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع — أعد المحاولة');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const locked = lockSeconds > 0;

  return (
    <main className="login-page">
      <div className="login-card" aria-labelledby="login-title">
        {sessionExpired && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="انتهت جلستك بسبب الخمول"
            description="لم تُفقد أي بيانات حفظتها — سجّل الدخول من جديد وأكمل من حيث توقفت."
          />
        )}
        <BrandLogo size="large" />

        <Typography.Title id="login-title" level={4} className="login-title">
          نظام مطابقة كشوفات الحسابات
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="login-subtitle">
          سجّل الدخول للمتابعة
        </Typography.Paragraph>

        {error && (
          <Alert
            role="alert"
            type="error"
            showIcon
            message={error}
            className="login-alert"
            closable
            onClose={() => setError(null)}
          />
        )}

        <Form<LoginFormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={onFinish}
          autoComplete="off"
          disabled={locked || submitting}
        >
          <Form.Item
            label="اسم المستخدم"
            name="username"
            rules={[{ required: true, message: 'أدخل اسم المستخدم' }]}
          >
            <Input
              prefix={<UserOutlined aria-hidden="true" />}
              placeholder="مثال: reconciler"
              autoComplete="username"
              autoFocus
            />
          </Form.Item>

          <Form.Item
            label="كلمة المرور"
            name="password"
            rules={[{ required: true, message: 'أدخل كلمة المرور' }]}
          >
            <Input.Password
              prefix={<LockOutlined aria-hidden="true" />}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 8 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={submitting}
              disabled={locked}
              size="large"
            >
              {locked ? `حُظر مؤقتاً — حاول بعد ${formatRemaining(lockSeconds)}` : 'تسجيل الدخول'}
            </Button>
          </Form.Item>
        </Form>

        {/* حسابات المعاينة — نفس المستخدمين المزروعين في قاعدة التطوير */}
        <details className="login-demo">
          <summary>حسابات المعاينة (بيئة التطوير)</summary>
          <ul>
            {DEMO_ACCOUNTS.map((acc) => (
              <li key={acc.username}>
                <button
                  type="button"
                  className="login-demo-account"
                  onClick={() => {
                    form.setFieldsValue({ username: acc.username, password: acc.password });
                  }}
                  aria-label={`تعبئة بيانات ${ROLE_LABELS[acc.role]} ${acc.fullName}`}
                >
                  <strong>{ROLE_LABELS[acc.role]}</strong> — {acc.username} / {acc.password}
                </button>
              </li>
            ))}
          </ul>
        </details>

        <footer className="login-footer">
          <LanguageSwitch />
          <Typography.Text type="secondary" className="login-version">
            الإصدار 0.1.0 — نسخة داخلية للمعاينة
          </Typography.Text>
        </footer>
      </div>
    </main>
  );
}
