# النشر بخطوة واحدة — دليل عملي

> يكمل `docs/CLOUD-DEPLOYMENT.md` (الشرح الطويل). هنا الملفات الجاهزة والخطوات
> التنفيذية فقط. **لا تضع أي سر في Git**: `.env` مستثنى، والقيم الحقيقية تُدخل
> في مدير أسرار المنصة أو ملف `600` على الخادم.

## 1. ما أُضيف

| الملف | الغرض |
|---|---|
| `Dockerfile` | صورة واحدة تبني الواجهة والخادم وتخدمهما على أصل واحد |
| `.dockerignore` | استبعاد `node_modules` و`storage` والاختبارات والتوثيق من سياق البناء |
| `docker-compose.yml` | قاعدة PostgreSQL 16 + خدمة هجرات + خادم، مع أقراص دائمة |
| `.env.example` | نموذج الأسرار المطلوبة |
| `render.yaml` | نشر بنقرة على Render (Docker + PostgreSQL + قرص دائم) |
| `backend/scripts/docker-entrypoint.sh` | هجرات تلقائية عند الإقلاع ثم تشغيل الخادم |

الخادم يخدم `frontend/dist` من نفس الأصل عند وجودها (أو `SERVE_FRONTEND=1`)،
مع إعادة توجيه كل مسار غير `/api` إلى `index.html`، وكاش طويل لملفات `assets`
بلا كاش لـ`index.html` و`sw.js`. لذلك يبقى الكوكي `SameSite=Strict` بلا CORS.

## 2. تشغيل محلي كامل بالحاويات

```bash
cp .env.example .env          # ثم املأ PGPASSWORD وBACKUP_ENCRYPTION_KEY
docker compose up -d --build
curl http://localhost:3000/api/v1/health
```

- أول حساب مدير (لا تستخدم `db:seed` في الإنتاج):

```bash
docker compose exec api sh -lc "ADMIN_USERNAME=admin ADMIN_FULL_NAME='مدير النظام' \
  ADMIN_PASSWORD='<كلمة-مؤقتة-قوية>' ADMIN_CONFIRM='reconciliation/admin' \
  node --import tsx scripts/create-admin.ts --apply"
```

> إن لم تتوفر `tsx` في صورة الإنتاج، شغّل الأمر من نسخة التطوير أو أضف حزمة
> `tsx` كاعتماد إنتاج. البديل الموصى به: `npm run db:create-admin` على خادم
> فيه أدوات التطوير، ثم انسخ القاعدة/النسخة.

- الإيقاف مع الحفاظ على البيانات: `docker compose down` (لا تستخدم `-v`).
- النسخ الاحتياطي: من شاشة الإدارة أو `docker compose exec api node scripts/verify-backup.mjs`
  للتحقق، وانقل ملفات `.enc` خارج الجهاز دورياً.

## 3. نشر على Render

1. اربط مستودع GitHub في Render → **New > Blueprint** → اختر `render.yaml`.
2. أدخل `BACKUP_ENCRYPTION_KEY` في لوحة الخدمة (64 حرفاً ست عشرياً) واحفظه خارج المنصة.
3. انتظر بناء الصورة، ثم افتح `https://<name>.onrender.com/api/v1/health`.
4. أنشئ حساب المدير من Shell الخدمة (نفس أمر القسم 2).

قيود يجب معرفتها قبل الاعتماد:

- **الخطة المجانية** بلا قرص دائم: ملفات الرفع والنسخ تُفقد عند كل إعادة نشر،
  وقاعدة البيانات المجانية قد تُوقف. لا تُستخدم لبيانات مالية حقيقية.
- `render.yaml` يستخدم خطة `starter` وقرص 10GB وقاعدة `basic-256mb`؛ راجع التكلفة
  قبل التفعيل.
- النطاق المخصص وHTTPS: Render يوفرهما تلقائياً؛ اربط نطاق المالك من لوحة الخدمة.

## 4. نشر على VPS (بديل بلا حاويات)

اتبع `docs/CLOUD-DEPLOYMENT.md` القسم 3 كما هو (Node + PostgreSQL + Caddy).
الفرق الوحيد أن `backend/src/server.ts` صار قادراً على خدمة الواجهة بنفسه،
فيمكن الاستغناء عن كتلة `root * /srv/mushabaka/frontend/dist` في Caddy
واستخدام `reverse_proxy 127.0.0.1:3000` لكل المسارات مع `SERVE_FRONTEND=1`.

## 5. قائمة تحقق بعد النشر

- [ ] `/api/v1/health` يعيد `{"status":"ok","db":"up"}` عبر HTTPS فقط.
- [ ] فتح `/login` ثم `/sessions` يعمل بلا 404 (توجيه SPA).
- [ ] الكوكي: `Secure`, `HttpOnly`, `SameSite=Strict`.
- [ ] رفع كشف CSV/PDF ثم اعتماده، وتنزيل تقرير.
- [ ] إنشاء نسخة `.enc` ثم بروفة استعادة على قاعدة مؤقتة.
- [ ] `storage/` على قرص دائم، والمنافذ 5432/3000 غير مفتوحة للإنترنت.
- [ ] تدوير كلمة `admin` الأولى، وإبطال أي جلسات تجريبية.
