import { CloudUploadOutlined, DownloadOutlined, DeleteOutlined, RestOutlined, SafetyCertificateFilled } from '@ant-design/icons';
import { App, Alert, Button, Input, Modal, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/AuthContext';
import {
  createBackup,
  deleteBackup,
  downloadBackup,
  formatSize,
  listBackups,
  restoreBackup,
} from './settingsClient';
import type { BackupInfo } from './settingsClient';

/**
 * تبويب النسخ الاحتياطي — حقيقي (Module 6، محلي 100%):
 * نسخة الآن = ملف JSON واحد بكل البيانات (يُنزَّل ويُحفظ خارجياً — R6) ·
 * الاسترجاع بأخطر حافز: نافذة حمراء + كتابة كلمة «استرجاع» حرفياً.
 */

const RESTORE_KEYWORD = 'استرجاع';

export function BackupTab() {
  const { message, modal } = App.useApp();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');

  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupInfo | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(() => {
    if (!isAdmin) return;
    setLoading(true);
    listBackups()
      .then(setBackups)
      .catch(() => message.error('تعذر جلب قائمة النسخ'))
      .finally(() => setLoading(false));
  }, [isAdmin, message]);

  useEffect(load, [load]);

  const runBackup = () => {
    setRunning(true);
    createBackup()
      .then((b) => {
        message.success(`أُنشئت النسخة (${formatSize(b.sizeBytes)}) — نزّلها واحفظها على قرص خارجي بصفة دورية (R6)`);
        load();
      })
      .catch((e: { messageAr?: string; message?: string }) => message.error(e?.messageAr ?? 'فشل إنشاء النسخة'))
      .finally(() => setRunning(false));
  };

  const doRestore = () => {
    if (!restoreTarget) return;
    setRestoring(true);
    restoreBackup(restoreTarget.name)
      .then((r) => {
        modal.success({
          title: 'نجح الاسترجاع',
          content: `عاد النظام لحالة النسخة ${r.restored}. سجّل الدخول من جديد إن طُلب منك.`,
        });
        setRestoreTarget(null);
        setConfirmText('');
        load();
      })
      .catch((e: { messageAr?: string; message?: string }) => message.error(e?.messageAr ?? 'فشل الاسترجاع'))
      .finally(() => setRestoring(false));
  };

  const columns: ColumnsType<BackupInfo> = [
    {
      title: 'النسخة',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Typography.Text className="financial-numbers" style={{ fontSize: 12 }}>{name}</Typography.Text>,
    },
    {
      title: 'أُنشئت',
      dataIndex: 'createdAt',
      key: 'created',
      width: 170,
      render: (v: string) => <span className="financial-numbers">{v.slice(0, 16).replace('T', ' ')}</span>,
    },
    {
      title: 'الحجم',
      dataIndex: 'sizeBytes',
      key: 'size',
      width: 90,
      render: (v: number) => <span className="financial-numbers">{formatSize(v)}</span>,
    },
    { title: 'أنشأها', dataIndex: 'createdBy', key: 'by', width: 110 },
    {
      title: 'محتوى مختصر',
      key: 'counts',
      render: (_, b) => (
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          جلسات {b.counts.reconciliation_sessions ?? 0} · كشوف {b.counts.statements ?? 0} · موردين {b.counts.partners ?? 0}
        </Typography.Text>
      ),
    },
    {
      title: 'إجراءات',
      key: 'act',
      width: 220,
      render: (_, b) => (
        <>
          <Button size="small" icon={<DownloadOutlined aria-hidden="true" />} onClick={() => downloadBackup(b.name)}>
            تنزيل
          </Button>{' '}
          <Button size="small" danger icon={<RestOutlined aria-hidden="true" />} onClick={() => { setRestoreTarget(b); setConfirmText(''); }}>
            استرجاع
          </Button>{' '}
          <Button
            size="small"
            type="text"
            icon={<DeleteOutlined aria-hidden="true" />}
            aria-label={`حذف ${b.name}`}
            onClick={() =>
              modal.confirm({
                title: 'حذف هذه النسخة؟',
                content: 'حذف الملف نهائي — تأكد من وجود نسخة خارجية قبل الحذف.',
                okText: 'حذف',
                okButtonProps: { danger: true },
                cancelText: 'تراجع',
                onOk: () =>
                  deleteBackup(b.name)
                    .then(() => {
                      message.success('حُذفت النسخة');
                      load();
                    })
                    .catch((e: { messageAr?: string; message?: string }) => message.error(e?.messageAr ?? 'فشل الحذف')),
              })
            }
          />
        </>
      ),
    },
  ];

  const last = backups[0];

  return (
    <div className="backup-tab">
      <Alert
        type={last ? 'success' : 'warning'}
        showIcon
        icon={<SafetyCertificateFilled aria-hidden="true" />}
        message={
          last
            ? `آخر نسخة: ${last.createdAt.slice(0, 16).replace('T', ' ')} (${formatSize(last.sizeBytes)})`
            : 'لا توجد أي نسخة احتياطية بعد — أنشئ الأولى الآن'
        }
        description="نسخة النظام ملف واحد محلي (JSON) يشمل كل البيانات. احفظ نسخة على قرص خارجي بصفة دورية — النسخ على نفس الجهاز لا تحمي من عطل القرص (R6)."
      />

      <div style={{ margin: '16px 0' }}>
        <Button type="primary" icon={<CloudUploadOutlined aria-hidden="true" />} loading={running} onClick={runBackup}>
          نسخة احتياطية الآن
        </Button>
      </div>

      <Table<BackupInfo>
        rowKey="name"
        size="small"
        columns={columns}
        dataSource={backups}
        loading={loading}
        pagination={false}
        locale={{ emptyText: 'لا نسخ محفوظة على هذا الجهاز' }}
      />

      {/* نافذة الاسترجاع — أخطر عملية: حافز مزدوج (نافذة حمراء + كتابة الكلمة) */}
      <Modal
        open={Boolean(restoreTarget)}
        title={<Typography.Text type="danger">استرجاع نسخة — عملية بالغة الخطورة</Typography.Text>}
        onCancel={() => setRestoreTarget(null)}
        okButtonProps={{ danger: true, disabled: confirmText.trim() !== RESTORE_KEYWORD, loading: restoring }}
        okText="تأكيد الاسترجاع"
        cancelText="تراجع"
        onOk={doRestore}
      >
        <Typography.Paragraph>
          سيُستبدل <strong>كل</strong> محتوى القاعدة الحالي بمحتوى النسخة{' '}
          <strong className="financial-numbers">{restoreTarget?.name}</strong> — كل ما أُدخل بعدها يضيع.
          الاسترجاع لا يُتراجع عنه.
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          تأكد من وجود نسخة أحدث من هذه، ومن أن المستخدمين آخرين سيعيدون تسجيل الدخول.
        </Typography.Paragraph>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={`اكتب «${RESTORE_KEYWORD}» حرفياً للتفعيل`}
          aria-label="تأكيد الاسترجاع بالكتابة"
        />
        <Tag color="red" style={{ marginTop: 8 }}>
          اكتب: {RESTORE_KEYWORD}
        </Tag>
      </Modal>
    </div>
  );
}
