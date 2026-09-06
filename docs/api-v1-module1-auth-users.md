# مواصفة API المنفذة — الوحدة 1: المصادقة والمستخدمون

> النسخة المنفذة فعلياً في `backend/src` (Module 1 مكتمل ومختبَر بالـ curl).
> البادئة لكل المسارات: `/api/v1`. الجلسة عبر كوكي `recon_session` (httpOnly, SameSite=Strict، عمر 12 ساعة انزلاقي).

## تغيير توثيقي على مواصفة Stage 2 (§4.2)

مسارات إدارة المستخدمين نُفذت **بالأسلوب القياسي** بدل لواحق `:action`
(Express 5 لا يدعم أنماط `/:id(\d+):action`):

| في المواصفة الأصلية | المنفذ فعلياً |
|---|---|
| `POST /users/{id}:deactivate` | `POST /users/{id}/deactivate` |
| `POST /users/{id}:activate` | `POST /users/{id}/activate` |
| `POST /users/{id}:force-password-change` | `POST /users/{id}/force-password-change` |

بقية المسارات مطابقة. Frontend سيربط المسارات المنفذة.

## شكل الاستجابة الموحد

- نجاح بيانات: `200/201` مع الكائن مباشرة (`{user}`, `{users}`, …)
- نجاح بلا محتوى: `204`
- خطأ: `{ "error": { "code": "...", "messageAr": "...", "traceId": "a1b2c3d4", "details"? } }`
  - `messageAr` جاهزة للعرض للمستخدم كما هي
  - `traceId` للربط مع سجل الخادم عند الدعم الفني
  - `details` في أخطاء التحقق: `[{field, messageAr}]`

## 1) المصادقة

### `POST /auth/login`
- المدخلات: `{username, password}` — تحقق: مطلوبان.
- سلوك الحماية: **قفل بعد 5 محاولات فاشلة لمدة 5 دقائق** (حتى بالمرور الصحيح).
  المحاولة الناجحة تصفّر العداد.
- `200` → `{user: PublicUser}` + `Set-Cookie: recon_session=…; HttpOnly; SameSite=Strict`
- `401 INVALID_CREDENTIALS` · `423 ACCOUNT_LOCKED {details:{retryAfterSeconds}}` · `403 ACCOUNT_DISABLED` · `422 VALIDATION_FAILED`

### `POST /auth/logout` (جلسة صالحة)
- `204` — يُبطل الجلسة في قاعدة البيانات ويمسح الكوكي.

### `GET /auth/me` (جلسة صالحة)
- `200` → `{user: PublicUser}` — يستخدمه الـ frontend عند تحميل الصفحة بدل تخزين المستخدم.

### `POST /auth/change-password` (جلسة صالحة)
- المدخلات: `{currentPassword, newPassword}` — الجديدة: 8+ أحرف، حرف ورقم، تختلف عن الحالية.
- `200` → `{user}` (و`mustChangePassword` يصفَّر) · `400 WRONG_PASSWORD`

### `PublicUser`
```json
{ "id": 1, "username": "admin", "fullName": "أحمد المدير", "role": "admin", "mustChangePassword": false }
```
(كلمة المرور والعدادات الداخلية لا تخرج أبداً من الخادم.)

## 2) المستخدمون (Admin فقط — viewer/reconciler يحصلان 403)

### `GET /users` → `{users: PublicUser[]}`
### `POST /users` `201`
- `{username (a-z0-9._-، 3+), fullName (2+), role (admin|reconciler|viewer), initialPassword (8+)}`
- `409 USERNAME_TAKEN`
- المستخدم الجديد يبدأ بـ `mustChangePassword: true`.

### `POST /users/{id}/deactivate`
- `200` → `{user}` · `409 SELF_DEACTIVATION` (لا يعطّل أحد نفسه)
- **تعطيل المستخدم يبطل جميع جلسته فوراً** (لا يبقى داخل النظام بحساب معطل).

### `POST /users/{id}/activate` → `200 {user}`
### `POST /users/{id}/force-password-change` → `204`
- يُجبر المستخدم على تغيير مروره في الدخول القادم (كما في شاشة Users بالـ frontend).

## 3) سجل التدقيق (Admin فقط — قراءة فقط)

### `GET /audit-log?limit=20&offset=0&actorId=&action=&search=`
- `200` → `{total, items: [{id, action, entityType, entityId, before, after, ip, createdAt, actor:{username, fullName}|null}]}`
- أحدث أولاً. الحد الأقصى للصفحة 100.

## قرارات تنفيذية

1. **كوكي بلا مكتبة إضافية**: تحليل الكوكي يدوي في وسيط مخصص بدل `cookie-parser` —
   كوكي واحد فقط في النظام، والاعتماديات أقل أسلم.
2. **انزلاقي 12 ساعة**: كل طلب ناجح يمدد الجلسة 12 ساعة (مواصفة §4.1) —
   المهمة طويلة (مطابقة كشف كامل) لا تُقطع منتصف العمل.
3. **إبطال فوري عند التعطيل**: قاعدة "الأمان أولاً" — التعطيل يموت الجلسات في نفس الطلب.
4. **قفل القاعدة لا الذاكرة**: العدادات والقفل في جدول users نفسه — يعمل مع عدة عمليات خادم مستقبلاً.
5. **بذور المعاينة** (`npm run db:seed`): admin/Admin@2026، reconciler/Recon@2026، viewer/Viewer@2026
   بـ `mustChangePassword: false` لتثبيت العرض. في الإنتاج يُنشأ admin الأول بإجبار تغيير المرور.

## نتائج اختبار الوحدة (curl — 6 سبتمبر 2026)

| السيناريو | النتيجة |
|---|---|
| صحة الخادم وقاعدة البيانات `/health` | ✓ db:up |
| دخول خاطئ | ✓ 401 INVALID_CREDENTIALS |
| مدخلات ناقصة | ✓ 422 + تفاصيل عربية بالحقول |
| دخول صحيح → كوكي httpOnly | ✓ 200 + Set-Cookie |
| `GET /me` بالكوكي | ✓ 200 |
| viewer يطلب `/users` | ✓ 403 FORBIDDEN |
| 5 محاولات فاشلة | ✓ ACCOUNT_LOCKED (حتى بالمرور الصحيح) |
| إنشاء مستخدم (admin) | ✓ 201 + mustChangePassword:true |
| اسم مكرر | ✓ 409 USERNAME_TAKEN |
| تعطيل الذات | ✓ 409 SELF_DEACTIVATION |
| تعطيل مستخدم داخِل | ✓ جلسته تُبطل فوراً |
| تغيير المرور | ✓ 200 + تصفير mustChangePassword |
| خروج ثم استخدام الجلسة | ✓ 204 ثم 401 |
| audit-log | ✓ 16 حدثاً بالفاعل والإجراء |
