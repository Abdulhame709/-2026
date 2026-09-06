# مواصفة API المنفذة — الوحدة 2: الشركاء والحسابات

> المنفذ في `backend/src` (Module 2 مكتمل ومختبَر بالـ curl — 12 سيناريو + فحص التسلسل).
> البادئة `/api/v1`. الصلاحيات: **الكتابة** = Admin + Reconciler، **القراءة** = الجميع المصادقون.

## قرارات المالك المطبقة في هذه الوحدة

1. **النطاق الكامل**: شركاء + حسابات + إعدادات مطابقة + خريطة مراجع + تسويات مبلَّغة + قوالب استيراد.
2. **الرمز هجين**: النظام يقترح `SUP-005` (تسلسلي) ويمكن استبداله بكود يدوي عند الإنشاء — فحص تكرار دائماً.
3. **التعطيل يحفظ التاريخ**: تعطيل مورد له كشوفات مسموح — يمنع الجديد فقط ولا يمس أي سجل (يظهر «معطل» بالقائمة).
4. **تعدد العملات**: نفس المورد قد يملك حساب YER وحساب USD وحساب SAR في آنٍ واحد — فريد (مورد × عملة).

## 1) الشركاء

| المسار | الوصف |
|---|---|
| `GET /partners` | القائمة كاملة **مع حسابات كل مورد** (قائمة الشاشة تحتاجها جاهزة) |
| `POST /partners` | `{code?, nameAr, nameEn?, phone?, email?, notes?}` → `201 {partner}` — الرمز اختياري (هجين) |
| `GET /partners/{id}` | تفصيل بالحسابات → `404 PARTNER_NOT_FOUND` |
| `PUT /partners/{id}` | تعديل الحقول و/أو `isActive` → `200` — يُسجل في التدقيق كـ ACTIVATE/DEACTIVATE تلقائياً |

- أخطاء: `409 PARTNER_CODE_TAKEN` · `422 VALIDATION_FAILED` (الاسم 2+ حرف، الرمز أحرف/أرقام/شرطات 3–20).

## 2) الحسابات (حساب لكل عملة)

| المسار | الوصف |
|---|---|
| `GET /partners/{id}/accounts` | حسابات المورد |
| `POST /partners/{id}/accounts` | `{currencyCode, ourLedgerCode?, dateWindowDays?}` → `201` |
| `PUT /accounts/{id}/matching-settings` | `{dateWindowDays?, ruleOrder?}` — نافذة التاريخ 0–30 (افتراضي 3) + ترتيب القواعد الأربع كاملة بلا تكرار |

- أخطاء: `409 ACCOUNT_EXISTS` (نفس العملة مكررة) · `422 CURRENCY_NOT_FOUND` (عملة خارج YER/USD/SAR) · `422 BAD_RULE_ORDER`.

## 3) خريطة المراجع

| المسار | الوصف |
|---|---|
| `GET /accounts/{id}/ref-map` | كل الارتباطات (ourRef ↔ theirRef + المصدر) |
| `POST /accounts/{id}/ref-map` | `{ourRef, theirRef}` — إضافة يدوية (`source: manual`)؛ إعادة نفس الثلاثي تُحدّث بلا خطأ |
| `DELETE /accounts/{id}/ref-map/{entryId}` | حذف ارتباط → `204` |

## 4) التسويات المبلَّغة

| المسار | الوصف |
|---|---|
| `GET /accounts/{id}/notified-adjustments` | الأحدث أولاً (خصم/مرتجع/أخرى بمبلغ وعملة) |
| `POST /accounts/{id}/notified-adjustments` | `{adjustmentDate: YYYY-MM-DD, adjustmentType: discount\|return\|other, amount>0, currencyCode, note?}` |

## 5) قوالب الاستيراد

| المسار | الوصف |
|---|---|
| `GET /accounts/{id}/import-templates` | قوالب **كشوفهم** الخاصة + قالب **كشوفنا** المشترك (ONYX PRO) |
| `POST /accounts/{id}/import-templates` | `{templateKind, name, headerRows, columnsMapping, dateFormats?, decimalSep?, thousandSep?, isDefault?}` |
| `POST /import-templates/ours` | قالب كشوفنا المشترك (`account_id = NULL`) |

- `columnsMapping` مثال: `{"date":"A","ref":"B","description":"C","debit":"D","credit":"E"}`.
- `isDefault: true` يُزيح الافتراضي السابق لنفس (الحساب، النوع) — الافتراضي وحيد.

## أحداث التدقيق الجديدة

`PARTNER_CREATE` · `PARTNER_UPDATE` · `PARTNER_ACTIVATE` · `PARTNER_DEACTIVATE` · `ACCOUNT_CREATE` · `MATCHING_SETTINGS_UPDATE` · `REFMAP_SAVE` · `REFMAP_DELETE` · `ADJUSTMENT_ADD` · `TEMPLATE_SAVE`

## نتائج الاختبار (curl — 12 سيناريو)

| السيناريو | النتيجة |
|---|---|
| قائمة الشركاء بحساباتهم (4 موردين مزروعين) | ✓ |
| رمز تلقائي هجين → SUP-005 | ✓ (بعد إصلاح دمج bigint النصي "4"+1="41") |
| رمز يدوي مكرر | ✓ 409 PARTNER_CODE_TAKEN |
| عملة ثانية لنفس المورد | ✓ 201 (D4) |
| تكرار نفس العملة | ✓ 409 ACCOUNT_EXISTS |
| إعدادات مطابقة (نافذة 5 + ترتيب معكوس) | ✓ |
| ترتيب قواعد ناقص | ✓ 422 برسالة عربية |
| خريطة مراجع: قراءة + إضافة يدوية | ✓ |
| تسوية مبلَّغة (خصم 250,000 YER) | ✓ |
| قالب كشوفهم + قالب كشوفنا المشترك | ✓ |
| viewer: قراءة 200 / كتابة 403 | ✓ |
| تعطيل مورد (يبقى بالقائمة معطلاً) | ✓ |

## بذور المعاينة

`npm run db:seed` يضيف (مضمناً): 4 موردين بحساباتهم —
SUP-001 دريم لاند (YER/2101) · SUP-002 النور (YER/2102) · SUP-003 الأمل (USD/2103) · SUP-004 الغربية (SAR/2104) + ارتباطا مراجع تجريبيان لدريم لاند.
