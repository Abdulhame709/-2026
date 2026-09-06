import { Empty, Typography } from 'antd';

/**
 * صفحة "قيد البناء" — للشاشات التي لم يأتِ دورها في خطة التنفيذ المتفق عليها.
 * تحافظ على صحة التنقل بدل روابط ميتة.
 */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section aria-label={title} style={{ padding: 24 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {title}
      </Typography.Title>
      <Empty description="هذه الشاشة ستُبنى في خطوة قادمة حسب ترتيب التنفيذ المتفق عليه" />
    </section>
  );
}
