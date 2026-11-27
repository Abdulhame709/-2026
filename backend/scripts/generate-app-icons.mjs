/**
 * يولّد أيقونات تطبيق الهاتف (PWA) بأحجامها القياسية من رسم واحد.
 * الرسم بلا خطوط نصية حتى يبقى ثابتاً على كل بيئة، ويكفي تشغيله عند تغيير الهوية:
 *   cd backend && node scripts/generate-app-icons.mjs
 * الوجهة: frontend/public/icons
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const outputDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'public', 'icons');
const SIZE = 1024;

/** يرسم الأيقونة على مربع كامل (بلا شفافية) — يصلح أيضاً كأيقونة maskable. */
function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const unit = size / 1024;

  // خلفية متدرجة بلون الهوية
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#155e93');
  gradient.addColorStop(1, '#0b3a63');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // مستند أبيض بحواف مستديرة
  const docX = 248 * unit;
  const docY = 176 * unit;
  const docW = 528 * unit;
  const docH = 672 * unit;
  const radius = 56 * unit;
  ctx.beginPath();
  ctx.moveTo(docX + radius, docY);
  ctx.arcTo(docX + docW, docY, docX + docW, docY + docH, radius);
  ctx.arcTo(docX + docW, docY + docH, docX, docY + docH, radius);
  ctx.arcTo(docX, docY + docH, docX, docY, radius);
  ctx.arcTo(docX, docY, docX + docW, docY, radius);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // أسطر المستند
  ctx.fillStyle = '#cbd5e1';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect((320 + i * 40) * unit, (300 + i * 96) * unit, (384 - i * 72) * unit, 34 * unit);
  }

  // إشارة صح خضراء (شارة تقاطع مع المستند)
  const badgeX = 724 * unit;
  const badgeY = 728 * unit;
  const badgeR = 196 * unit;
  ctx.beginPath();
  ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
  ctx.fillStyle = '#16a34a';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 26 * unit;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(badgeX - 92 * unit, badgeY + 4 * unit);
  ctx.lineTo(badgeX - 24 * unit, badgeY + 72 * unit);
  ctx.lineTo(badgeX + 96 * unit, badgeY - 64 * unit);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 46 * unit;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  return canvas;
}

function resize(source, size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, size, size);
  return canvas;
}

const master = drawIcon(SIZE);
await mkdir(outputDir, { recursive: true });

const targets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
  ['apple-touch-icon.png', 180],
];
for (const [name, size] of targets) {
  await writeFile(join(outputDir, name), resize(master, size).toBuffer('image/png'));
  console.log(`wrote ${name} (${size}x${size})`);
}
