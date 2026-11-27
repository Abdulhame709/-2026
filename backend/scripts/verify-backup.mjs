import { BackupService } from '../dist/application/backup.service.js';

const name = process.argv[2];
if (!name || !/^backup-[A-Za-z0-9._-]+\.enc$/.test(name)) {
  throw new Error('Provide the exact encrypted backup filename.');
}

const service = new BackupService(null, null);
const backup = (await service.list()).find((item) => item.name === name);
if (!backup || !backup.readable || !backup.encrypted || !backup.includesUploads) {
  throw new Error('Backup is missing, unreadable, or does not include uploaded files.');
}

console.log(`Verified encrypted backup: ${backup.name}`);
console.log(`Uploaded files: ${backup.fileCount}; backup bytes: ${backup.sizeBytes}`);
