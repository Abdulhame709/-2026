# النشر السحابي وتطبيق الهاتف (PWA)

> هذا الدليل يشرح كيف ينتقل النظام من جهاز Windows محلي إلى سحابة بنطاق HTTPS، وكيف
> يُثبَّت على الهاتف كتطبيق. لا يغني عن `docs/DEPLOYMENT-SECURITY.md` و`docs/OPERATIONS-RUNBOOK.md`
> و`docs/REMEDIATION-PLAN.md`. الأسرار (كلمة مرور القاعدة، مفتاح النسخ) لا تدخل Git.

## 1. الإجابة المختصرة

- **سحابياً: نعم.** النظام خدمة ويب عادية (Node + PostgreSQL) وتعمل على أي سحابة Linux،
  مع ثلاثة شروط: نطاق + شهادة HTTPS، تخزين دائم لمجلد `backend/storage`، ومفتاح نسخ
  محفوظ خارج الجهاز.
- **تطبيق هاتف: نعم، كـPWA** (تثبيت من المتصفح) على أندرويد وiOS، بشرط HTTPS.
  ليس تطبيق متجر، ولا يعمل بلا شبكة للبيانات المالية — التخزين المؤقت يقتصر على
  واجهة التطبيق (انظر القسم 5).
- **ما لا يصلح نقله كما هو:** مفتاح النسخ المحمي بـWindows DPAPI (خاص بـWindows)، وربط
  الخادم على `127.0.0.1` وحده (يُضبط عبر `HOST`)، والبذور التجريبية (`db:seed` للتطوير فقط).

## 2. الخيارات

| الخيار | الأنسب لـ | ملاحظات |
|---|---|---|
| جهاز Linux واحد (VPS) + Caddy | نشر داخلي صغير (5–20 مستخدماً) | الأبسط والأرخص؛ كل شيء على جهاز واحد مع نسخ خارجية |
| منصة حاويات (PaaS) | فريق تقني يدير النشر | تحتاج قرصاً دائماً للرفع والنسخ، وخدمة PostgreSQL مُدارة |
| Kubernetes | مؤسسة كبيرة | زيادة تعقيد بلا حاجة حالياً |

**الحد الأدنى المقترح:** 2 vCPU، ذاكرة 4GB (OCR يستهلك ذاكرة عند أول صورة)، قرص SSD 40GB،
نسخة PostgreSQL 16+. المورد اليمني/السعودي يفضّل مركز بيانات قريباً (البحرين/جدة/فرانكفورت)
لأجل زمن الاستجابة، مع مراجعة متطلبات بقاء البيانات داخل البلد قبل الاختيار.

## 3. نشر على جهاز Linux واحد (المسار الموصى به)

### 3.1 التحضير

```bash
# Ubuntu 24.04 — باسم مستخدم إداري
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw postgresql-16
# Node.js 22 LTS من المستودع الرسمي (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs caddy
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
```

- أنشئ مستخدم خدمة غير جذري: `sudo adduser --system --group --home /srv/mushabaka mushabaka`.
- انسخ المستودع (خاص) إلى `/srv/mushabaka`: `sudo -u mushabaka git clone <repo> /srv/mushabaka`.
- **لا تفتح منفذ 5432 للإنترنت.**

### 3.2 قاعدة البيانات

```bash
sudo -u postgres psql <<'SQL'
CREATE USER mushabaka_app WITH PASSWORD '<كلمة-مرور-قوية-فريدة>';
CREATE DATABASE reconciliation OWNER mushabaka_app;
SQL
```

### 3.3 بناء التطبيق

```bash
cd /srv/mushabaka/backend && sudo -u mushabaka npm ci && sudo -u mushabaka npm run build
cd /srv/mushabaka/frontend && sudo -u mushabaka npm ci && sudo -u mushabaka npm run build
```

ثم الهجرات (تتطلب بيانات الاتصال):

```bash
cd /srv/mushabaka/backend
sudo -u mushabaka env PGHOST=127.0.0.1 PGDATABASE=reconciliation PGUSER=mushabaka_app PGPASSWORD='<...>' npm run db:migrate
```

### 3.4 أول حساب مدير

`db:seed` مقصود للتطوير فقط (يضيف موردين تجريبيين). للإنتاج استخدم:

```bash
cd /srv/mushabaka/backend
sudo -u mushabaka env PGHOST=127.0.0.1 PGDATABASE=reconciliation PGUSER=mushabaka_app PGPASSWORD='<...>' \
  ADMIN_USERNAME=admin ADMIN_FULL_NAME='مدير النظام' ADMIN_PASSWORD='<كلمة-مؤقتة-قوية>' \
  ADMIN_CONFIRM='reconciliation/admin' npm run db:create-admin -- --apply
```

الحساب يُنشأ بـ`must_change_password=true`؛ أول دخول يفرض تغيير الكلمة. لا تطبع الكلمة
ولا تضعها في سجل الأوامر الدائم؛ سلّمها بقناة آمنة ثم احذفها من الذاكرة.

### 3.5 متغيرات البيئة

ملف `/etc/mushabaka/api.env` بصلاحية `600` وملكية مستخدم الخدمة:

```ini
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
COOKIE_SAMESITE=strict
TRUST_PROXY=loopback
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=mushabaka_app
PGDATABASE=reconciliation
PGPASSWORD=<كلمة-مرور-القاعدة>
BACKUP_ENCRYPTION_KEY=<64-حرفاً-ست عشرياً>
```

- `HOST=127.0.0.1` لأن Caddy على نفس الجهاز هو الواجهة العامة. داخل حاوية خلف موازن
  حمل استخدم `0.0.0.0` واقصر الوصول على شبكة الحاوية.
- `ISSUE_BEARER_TOKEN` يبقى غير مضبوط (الكوكي وحده).
- **مفتاح النسخ:** على Windows يُحمَّل من DPAPI؛ في السحابة يُقرأ من متغير بيئة يوفره
  مدير الأسرار (أو ملف `600`). احتفظ بنسخة ورقية/خارجية منه: بدونه لا يمكن فك أي
  نسخة مشفرة. لا تغيّره بعد بدء النسخ إلا بخطة تحويل.

### 3.6 خدمة systemd

`/etc/systemd/system/mushabaka-api.service`:

```ini
[Unit]
Description=Mushabaka reconciliation API
After=network.target postgresql.service

[Service]
Type=simple
User=mushabaka
Group=mushabaka
WorkingDirectory=/srv/mushabaka/backend
EnvironmentFile=/etc/mushabaka/api.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/srv/mushabaka/backend/storage

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now mushabaka-api
curl -s http://127.0.0.1:3000/api/v1/health
```

### 3.7 Caddy (HTTPS تلقائي + الواجهة والخادم على أصل واحد)

`/etc/caddy/Caddyfile` (استبدل النطاق):

```caddyfile
mushabaka.example.com {
    encode zstd gzip

    handle /api/* {
        reverse_proxy 127.0.0.1:3000
    }

    handle {
        root * /srv/mushabaka/frontend/dist
        try_files {path} /index.html
        file_server
        header {
            X-Content-Type-Options nosniff
            X-Frame-Options DENY
            Referrer-Policy no-referrer
        }
        @sw path /sw.js
        header @sw Cache-Control "no-cache"
        @manifest path /manifest.webmanifest
        header @manifest Content-Type "application/manifest+json"
    }
}
```

```bash
sudo systemctl reload caddy
```

**مهم:** الواجهة و`/api` على **نفس النطاق** حتى يبقى الكوكي `SameSite=Strict` آمناً
بلا CORS. لا تفصل الواجهة على نطاق آخر.

### 3.8 التخزين والأذونات

- `backend/storage/uploads` و`backend/storage/backups` و`backend/storage/tessdata` يجب أن
  تكون قابلة للكتابة لمستخدم الخدمة فقط: `chmod 700` و`chown -R mushabaka:mushabaka`.
- اربطها بقرص دائم إن استخدمت حاوية (Volume)، ولا تضعها على قرص مؤقت.
- النسخ الاحتياطي داخل الخادم لا يكفي: انقل النسخ المشفرة دورياً خارج الجهاز
  (`rclone` إلى S3/Backblaze أو قرص مشفر)، واحتفظ بالمفتاح منفصلاً عن النسخ.

### 3.9 قائمة تحقق ما بعد النشر

- [ ] `https://<domain>` يفتح الواجهة، و`/api/v1/health` سليم عبر HTTPS فقط.
- [ ] دخول المدير يفرض تغيير الكلمة، ثم يعمل بعدها.
- [ ] الكوكي في المتصفح: `Secure`, `HttpOnly`, `SameSite=Strict`.
- [ ] رفع كشف CSV عبر مسار تعيين الأعمدة ثم اعتماده، وتنزيل تقرير PDF/Excel.
- [ ] إنشاء نسخة احتياطية `.enc`، ثم بروفة استعادة على قاعدة مؤقتة (على السحابة نفسها).
- [ ] تشغيل `npm run db:rotate -- --check` والتحقق من الحسابات، وتدوير أي كلمة مرور تجريبية قديمة.
- [ ] التأكد من أن 5432 و3000 غير مفتوحين للإنترنت (`ss -lntp` + جدار الحماية).

## 4. النقل من النسخة المحلية

1. خذ نسخة مشفرة حديثة على Windows، وانسخ ملف `.enc` ومفتاحه (بقناة آمنة) إلى السحابة.
2. على السحابة: استعد النسخة في قاعدة/مجلد مؤقتين للتحقق فقط، ثم اعتمد الاستعادة على
   قاعدة الإنتاج بعد إيقاف الخدمة، أو استخدم مسار الاستعادة الموجود في شاشة الإدارة.
3. **لا تنسخ قاعدة Windows كما هي** (ترميز/مسارات)؛ استخدم أداة الاستعادة المدمجة.
4. بعد النقل: أعد تدوير كلمات المرور، وأبطل الجلسات، وحدّث `docs/OPERATIONS-RUNBOOK.md` بمسار السحابة.

## 5. تطبيق الهاتف (PWA)

### ما أُضيف في الشيفرة

- `frontend/public/manifest.webmanifest` (اسم عربي، RTL، أيقونات 192/512/maskable).
- `frontend/public/sw.js`: يخزّن واجهة التطبيق فقط، **ولا يخزّن أي طلب إلى `/api/`**.
  فتح الصفحات يفضّل الشبكة دائماً، والمخزون للطوارئ عند انقطاع الاتصال.
- أيقونات في `frontend/public/icons/` مولّدة بـ`backend/scripts/generate-app-icons.mjs`.
- تسجيل عامل الخدمة في `frontend/src/main.tsx` لنسخة البناء فقط.

### التثبيت

- **أندرويد (Chrome/Edge):** افتح الموقع عبر HTTPS → قائمة المتصفح → «تثبيت التطبيق»
  أو «إضافة إلى الشاشة الرئيسية».
- **iPhone/iPad (Safari):** زر المشاركة → «إضافة إلى الشاشة الرئيسية». لا يوجد زر تثبيت
  تلقائي على iOS، والتطبيق يفتح بملء الشاشة بعد الإضافة.
- **سطح المكتب (Chrome/Edge):** أيقونة التثبيت في شريط العنوان.

### حدود يجب أن تكون واضحة

- **لا عمل بلا شبكة:** لا تُخزَّن الكشوفات أو الموردون أو أي استجابة API، لأنها بيانات
  مالية. الانقطاع يعرض واجهة التطبيق فقط، لا بيانات.
- **iOS:** دعم إشعارات الويب للتطبيقات المثبتة من iOS 16.4+، ويبقى التخزين قابلاً للحذف
  من النظام؛ لا تعتمد عليه لحفظ عمل غير مُرسل.
- **التحديثات:** بعد نشر نسخة جديدة، حدّث الصفحة مرة واحدة عند أول فتح لإزالة الواجهة القديمة.
