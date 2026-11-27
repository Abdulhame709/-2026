# دليل التشغيل اليومي — وفاق الموردين

> هذا الدليل للإجراءات التشغيلية على جهاز Windows واحد (خادم داخلي). لا يحتوي أسرارًا؛ المفتاح وكلمات المرور تبقى خارج Git وفي مدير كلمات المرور.
> راجع أيضًا: `docs/INSTALL-LOCAL.md` (التثبيت)، `docs/BACKUP-KEY-SETUP.md` (المفتاح)، `docs/CREDENTIAL-ROTATION.md` (التدوير)، `docs/DEPLOYMENT-SECURITY.md` (النشر)، و`docs/REMEDIATION-PLAN.md` (المتبقي).

## 1. المتطلبات قبل البدء

- PostgreSQL يعمل محليًا، وقاعدة `reconciliation` مهيأة (`npm run db:migrate`).
- مفتاح النسخ مُعدّ مسبقًا بـ`setup-backup-key.bat` ومحفوظ خارج الجهاز (مدير كلمات المرور + USB).
- `backend/node_modules` و`frontend/node_modules` مثبتة (`npm ci`).
- اتصال قاعدة البيانات عبر متغيرات البيئة `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD` أو إعدادات `pool.ts` المحلية.

## 2. متغيرات البيئة المهمة

| المتغير | القيمة المعتمدة | الأثر |
|---|---|---|
| `NODE_ENV` | `production` للتشغيل، `development` للبذور فقط | البذور لا تعمل خارج التطوير |
| `PORT` | `3000` افتراضيًا | منفذ الخادم |
| `ISSUE_BEARER_TOKEN` | `on` فقط عند الحاجة لترويسة بديلة | وإلا الكوكي وحده |
| `COOKIE_SAMESITE` | `strict` افتراضيًا (`lax`/`none` يتطلبان HTTPS) | حماية CSRF |
| `TRUST_PROXY` | `loopback` فقط خلف وكيل محلي | وإلا يُتجاهل `X-Forwarded-*` |
| `BACKUP_ENCRYPTION_KEY` | يُحمَّل من DPAPI عبر سكربت البدء — لا يُكتب يدويًا | تشفير/فك النسخ |

## 3. بدء التشغيل

من مجلد `backend`:

```powershell
# تطوير (Vite منفصل من مجلد frontend)
powershell -ExecutionPolicy Bypass -File scripts/start-with-backup-key.ps1 -Mode dev

# تشغيل الإنتاج المحلي
powershell -ExecutionPolicy Bypass -File scripts/start-with-backup-key.ps1 -Mode start
```

- لا تشغّل الخادم بلا مفتاح النسخ؛ النسخ ستفشل برسالة واضحة.
- تأكد أن الخادم يستمع على `127.0.0.1` فقط ما لم تُعد HTTPS والوكيل (البند 6).

## 4. النسخ الاحتياطي والتحقق

**الوتيرة:** نسخة مشفرة قبل كل إدخال كبير، ونسخة يومية بعد إغلاق العمل، ونسخة أسبوعية تُنقل خارج الجهاز.

1. أنشئ النسخة من شاشة «النسخ الاحتياطي» (أدمن) أو `POST /api/v1/backups`.
2. تحقق من النسخة:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/start-with-backup-key.ps1 -Mode verify -BackupName "<name>.enc"
   ```
3. بروفة الاستعادة (شهريًا أو قبل أي ترقية) على قاعدة ومجلد مؤقتين:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/start-with-backup-key.ps1 -Mode rehearse -BackupName "<name>.enc"
   ```
   البروفة لا تلمس قاعدة العمل، وتنتهي بحذف القاعدة والمجلد المؤقتين.
4. لا تحذف النسخ القديمة قبل نجاح نسخة أحدث وفحص فكّها.
5. ملف `.json` القديم غير المشفر: حوّله من شاشة النسخ (زر التحويل) بعد التحقق، ثم أرشِفه/احذفه باتفاق — لا تحذفه قبل وجود بديل `.enc` صالح.

## 5. الحسابات وكلمات المرور

- **قرار `mustChangePassword`:** الخادم يمنع كل مسارات API عدا `/auth/me` و`/auth/logout` و`/auth/change-password`، لا الكتابة فقط. السبب: أي قراءة قد تكشف بيانات مالية قبل تأمين الحساب. الواجهة توجّه المستخدم لشاشة التغيير، وبعد التغيير تُبطل بقية جلساته.
- تدوير كلمة مرور (مثال `admin`) بعد نسخة مشفرة حديثة:
  ```powershell
  # فحص فقط — لا يغيّر شيًا
  npm run db:rotate -- --check
  # التنفيذ بعد تسليم آمن للكلمة الجديدة
  npm run db:rotate -- --apply
  ```
  الخطوات التفصيلية والتحقق في `docs/CREDENTIAL-ROTATION.md`. لا تُرسل الكلمة الجديدة بالبريد أو في Git.
- بعد التدوير: تحقق من رفض الكلمة القديمة، ومن إبطال الجلسات، وسجّل الحدث في سجل التدقيق (`CREDENTIAL_ROTATION`).

## 6. قبل إتاحة النظام على الشبكة

- [ ] شهادة HTTPS صالحة (IIS/وكيل) واختبار الكوكي والرفع والتنزيل والأصول عبر HTTPS.
- [ ] `TRUST_PROXY=loopback` خلف وكيل محلي فقط، و`COOKIE_SAMESITE` المناسب.
- [ ] تشديد أذونات `backend/storage/backups` و`backend/storage/uploads` (إزالة منح `Modify` لغير حساب الخدمة) بعد نسخة.
- [ ] نسخة مشفرة شاملة خارج الجهاز + بروفة استعادة على بيانات منزوعة الحساسية.
- [ ] مراجعة `docs/REMEDIATION-PLAN.md` والتأكد من إغلاق البنود الأمنية.

## 7. استكشاف الأخطاء السريع

| العرض | السبب المرجّح | الإجراء |
|---|---|---|
| «تعذر إنشاء النسخة» | مفتاح النسخ غير محمّل | شغّل عبر `start-with-backup-key.ps1` |
| «النسخة غير قابلة للتحقق» | عبث/نقل ناقص/مفتاح مختلف | لا تستعدها؛ استخدم نسخة أحدث وتحقق منها |
| 403 `PASSWORD_CHANGE_REQUIRED` | كلمة مؤقتة | غيّر الكلمة من الشاشة المخصصة |
| 403 `INVALID_ORIGIN` | طلب من أصل مختلف أو بلا كوكي | استخدم الواجهة الرسمية على نفس الأصل |
| الرفع يفشل بلا سبب | ترميز CSV غير UTF-8/UTF-16 أو توقيع ملف غير مطابق | أعد تصدير الملف أو استخدم المعالج لفحص الأعمدة |
| تعيين أعمدة خاطئ | ملف بترويسة غير قياسية | راجع لوحة التعيين واحفظها كقالب بعد النجاح |

## 8. التحقق الآلي

```powershell
cd backend; npm run typecheck; npm run test:import; npm run test:stage3; npm run test:backup
cd backend; npm run test:users; npm run test:statements-http; npm run test:backup-restore
cd frontend; npm run build
```

اختبارات `test:users` و`test:statements-http` و`test:backup-restore` و`test:ocr-db` تنشئ قاعدة/مجلدًا مؤقتًا وتحذفه بعد النجاح، وتحتاج `PGPASSWORD`. CI يشغّلها تلقائيًا (`.github/workflows/ci.yml`).
