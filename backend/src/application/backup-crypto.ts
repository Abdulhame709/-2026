import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError, ERR } from '../domain/errors.js';

const HEADER = Buffer.from([0x52, 0x43, 0x42, 0x4b, 0x01]);
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function backupKey(): Buffer {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new AppError('BACKUP_KEY_REQUIRED', 503, 'مفتاح تشفير النسخ غير مهيأ — عيّن BACKUP_ENCRYPTION_KEY كمفتاح عشوائي من 32 بايت قبل إنشاء نسخة أو استعادتها');
  }
  return Buffer.from(raw, 'hex');
}

export function encryptBackup(plaintext: Buffer, name: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH });
  cipher.setAAD(Buffer.concat([HEADER, Buffer.from(name, 'utf8')]));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([HEADER, iv, cipher.getAuthTag(), encrypted]);
}

export function decryptBackup(data: Buffer, name: string, key: Buffer): Buffer {
  if (data.length <= HEADER.length + IV_LENGTH + TAG_LENGTH || !data.subarray(0, HEADER.length).equals(HEADER)) {
    throw ERR.VALIDATION([{ field: 'name', messageAr: 'صيغة النسخة المشفرة غير مدعومة أو الملف تالف' }]);
  }
  const iv = data.subarray(HEADER.length, HEADER.length + IV_LENGTH);
  const tag = data.subarray(HEADER.length + IV_LENGTH, HEADER.length + IV_LENGTH + TAG_LENGTH);
  const encrypted = data.subarray(HEADER.length + IV_LENGTH + TAG_LENGTH);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAAD(Buffer.concat([HEADER, Buffer.from(name, 'utf8')]));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    throw ERR.VALIDATION([{ field: 'name', messageAr: 'فشل التحقق من النسخة المشفرة — المفتاح غير صحيح أو الملف عُدّل' }]);
  }
}
