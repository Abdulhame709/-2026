import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { backupKey, decryptBackup, encryptBackup } from '../dist/application/backup-crypto.js';

test('backup key is required and must be 32 bytes in hex', () => {
  const previous = process.env.BACKUP_ENCRYPTION_KEY;
  try {
    delete process.env.BACKUP_ENCRYPTION_KEY;
    assert.throws(() => backupKey(), { code: 'BACKUP_KEY_REQUIRED' });
    process.env.BACKUP_ENCRYPTION_KEY = 'not-a-key';
    assert.throws(() => backupKey(), { code: 'BACKUP_KEY_REQUIRED' });
  } finally {
    if (previous === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = previous;
  }
});

test('authenticated backup rejects tampering, renaming and a wrong key', () => {
  const key = randomBytes(32);
  const name = 'backup-test.enc';
  const plaintext = Buffer.from('{"important":"private"}');
  const encrypted = encryptBackup(plaintext, name, key);
  assert.ok(decryptBackup(encrypted, name, key).equals(plaintext));
  assert.ok(!encrypted.includes(plaintext));
  assert.throws(() => decryptBackup(encrypted, 'backup-renamed.enc', key), { code: 'VALIDATION_FAILED' });
  assert.throws(() => decryptBackup(encrypted, name, randomBytes(32)), { code: 'VALIDATION_FAILED' });
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptBackup(tampered, name, key), { code: 'VALIDATION_FAILED' });
});
