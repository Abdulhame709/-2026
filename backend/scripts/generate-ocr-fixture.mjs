/**
 * يولّد صورة الكشف المستخدمة في اختبار OCR الحقيقي (tests/import-reading.test.mjs).
 *
 * السبب: رسم النص داخل الاختبار يعتمد على خطوط النظام، وسطح المكتب في Windows يختلف
 * عن بيئة CI على Linux فينتج بايتات مختلفة قد لا يقرأها المحرك. الصورة المولّدة هنا
 * تُثبَّت في المستودع فتصبح بايتات الاختبار نفسها على كل بيئة.
 *
 * لا تُعِد توليد الصورة إلا بقرار واعٍ: تغيير البايتات قد يكسر توقعات الاختبار.
 * التشغيل من مجلد backend:  node scripts/generate-ocr-fixture.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'ocr-statement.png');

const canvas = createCanvas(1800, 280);
const context = canvas.getContext('2d');
context.fillStyle = 'white';
context.fillRect(0, 0, canvas.width, canvas.height);
context.fillStyle = 'black';
context.font = '48px Arial';
context.fillText('2026-02-01 Invoice for office supplies 100.00 0.00', 30, 150);

await mkdir(dirname(target), { recursive: true });
await writeFile(target, canvas.toBuffer('image/png'));
console.log(`wrote ${target}`);
