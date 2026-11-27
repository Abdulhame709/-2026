/**
 * بيانات تجريبية فقط لمشروع «وفاق الموردين».
 * تنشئ 3 جلسات مطابقة (كل جلسة = كشف الشركة + كشف المورد)،
 * بواقع 25 بنداً في كل كشف = 150 بند مصدر إجمالاً.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const destination = resolve('demo-data/supplier-reconciliation');
mkdirSync(destination, { recursive: true });

const header = ['التاريخ', 'نوع المستند', 'رقم المستند', 'البيان', 'المرجع', 'مدين', 'دائن'];
const money = (value) => value.toFixed(2);
const csv = (rows) => '\ufeff' + [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';

const rowsForMonth = (month, label) => {
  const year = 2026;
  const normal = Array.from({ length: 16 }, (_, index) => {
    const n = index + 1;
    const amount = 875 + ((n * 317 + month * 91) % 4125);
    const ref = `INV-${year}${String(month).padStart(2, '0')}-${String(n).padStart(3, '0')}`;
    const day = String(((n * 2 + month) % 25) + 1).padStart(2, '0');
    return { ref, amount, companyDate: `${year}-${String(month).padStart(2, '0')}-${day}`, supplierDate: `${year}-${String(month).padStart(2, '0')}-${String(Math.min(28, Number(day) + (n % 4 === 0 ? 2 : 0))).padStart(2, '0')}` };
  });

  const parts = [
    { ref: `INV-${year}${String(month).padStart(2, '0')}-A01`, amount: 2140 },
    { ref: `INV-${year}${String(month).padStart(2, '0')}-A02`, amount: 3680 },
    { ref: `INV-${year}${String(month).padStart(2, '0')}-A03`, amount: 1955 },
  ];
  const aggregateAmount = parts.reduce((sum, item) => sum + item.amount, 0);
  const payments = Array.from({ length: 5 }, (_, index) => ({
    ref: `PAY-${year}${String(month).padStart(2, '0')}-${String(index + 1).padStart(3, '0')}`,
    amount: 1800 + index * 650,
    date: `${year}-${String(month).padStart(2, '0')}-${String(19 + index).padStart(2, '0')}`,
  }));

  const company = [
    ...normal.map((item) => [item.companyDate, 'فاتورة مشتريات', item.ref, `فاتورة مشتريات ${item.ref} من مورد تجريبي`, item.ref, '', money(item.amount)]),
    [`${year}-${String(month).padStart(2, '0')}-17`, 'فاتورة مجمعة', `BATCH-${year}${String(month).padStart(2, '0')}`, `قيد تجميعي لفواتير ${parts.map((item) => item.ref).join(' / ')}`, `BATCH-${year}${String(month).padStart(2, '0')}`, '', money(aggregateAmount)],
    ...payments.map((item) => [item.date, 'سداد مورد', item.ref, `سداد للمورد التجريبي - ${item.ref}`, item.ref, money(item.amount), '']),
    [`${year}-${String(month).padStart(2, '0')}-24`, 'إشعار خصم', `DISC-${year}${String(month).padStart(2, '0')}`, 'خصم سعر صنف تم إشعار المورد به ولم يسجله', `DISC-${year}${String(month).padStart(2, '0')}`, money(425), ''],
    [`${year}-${String(month).padStart(2, '0')}-25`, 'مرتجع مشتريات', `RET-${year}${String(month).padStart(2, '0')}`, 'مرتجع للمورد، البضاعة أعيدت ولم يظهر القيد في كشف المورد', `RET-${year}${String(month).padStart(2, '0')}`, money(760), ''],
    [`${year}-${String(month).padStart(2, '0')}-26`, 'فاتورة مشتريات', `INT-${year}${String(month).padStart(2, '0')}`, 'فاتورة مقيدة في الشركة ولم يقيدها المورد بعد', `INT-${year}${String(month).padStart(2, '0')}`, '', money(1320)],
  ];

  const supplier = [
    ...normal.map((item) => [item.supplierDate, 'فاتورة', item.ref, `فاتورة المورد التجريبي ${item.ref}`, item.ref, money(item.amount), '']),
    ...parts.map((item, index) => [`${year}-${String(month).padStart(2, '0')}-${String(11 + index).padStart(2, '0')}`, 'فاتورة', item.ref, `فاتورة منفصلة ضمن القيد التجميعي ${item.ref}`, item.ref, money(item.amount), '']),
    ...payments.map((item) => [item.date, 'سند قبض', item.ref, `استلام سداد من الشركة - ${item.ref}`, item.ref, '', money(item.amount)]),
    [`${year}-${String(month).padStart(2, '0')}-27`, 'فاتورة', `PEND-${year}${String(month).padStart(2, '0')}`, 'فاتورة أثبتها المورد، والبضاعة ما زالت تحت التوريد للمخزن', `PEND-${year}${String(month).padStart(2, '0')}`, money(2875), ''],
  ];

  const expected = [
    ...normal.map((item) => [label, item.ref, item.ref, 'مطابقة مباشرة', `المبلغ متساوٍ؛ فرق التاريخ ${item.companyDate === item.supplierDate ? 'لا يوجد' : 'مسموح للمراجعة'} `]),
    [label, `BATCH-${year}${String(month).padStart(2, '0')}`, parts.map((item) => item.ref).join(' + '), 'مطابقة 1 إلى 3', 'تحتاج تأكيد المحاسب؛ مجموع الفواتير الثلاث يساوي القيد التجميعي'],
    ...payments.map((item) => [label, item.ref, item.ref, 'مطابقة سداد مباشرة', 'مبلغ السداد متساوٍ']),
    [label, `DISC-${year}${String(month).padStart(2, '0')}`, '—', 'فرق خصم', 'على المورد إصدار إشعار دائن أو تعديل الفاتورة'],
    [label, `RET-${year}${String(month).padStart(2, '0')}`, '—', 'فرق مرتجع', 'تأكيد استلام المرتجع ثم طلب قيد المورد'],
    [label, `INT-${year}${String(month).padStart(2, '0')}`, '—', 'مقيد بالشركة فقط', 'يتابع مع المورد إن كان القيد الداخلي صحيحاً'],
    [label, '—', `PEND-${year}${String(month).padStart(2, '0')}`, 'مقيد لدى المورد فقط', 'التحقق من حالة التوريد للمخزن قبل تسجيله محاسبياً'],
  ];
  return { company, supplier, expected };
};

const expectedHeader = ['الجلسة', 'مرجع الشركة', 'مرجع المورد', 'النتيجة المتوقعة', 'سبب/إجراء المراجع'];
const allExpected = [];
for (const [month, label] of [[3, 'مارس 2026'], [4, 'أبريل 2026'], [5, 'مايو 2026']]) {
  const { company, supplier, expected } = rowsForMonth(month, label);
  writeFileSync(resolve(destination, `شركة-تجريبية-${label}.csv`), csv(company), 'utf8');
  writeFileSync(resolve(destination, `مورد-تجريبي-${label}.csv`), csv(supplier), 'utf8');
  allExpected.push(...expected);
}
writeFileSync(resolve(destination, 'نتائج-متوقعة.csv'), '\ufeff' + [expectedHeader, ...allExpected].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n', 'utf8');

const readme = `# حزمة اختبار وهمية — وفاق الموردين

هذه الملفات مصطنعة بالكامل ولا تحتوي على أشخاص أو شركات أو فواتير حقيقية.

## المحتوى

- 3 جلسات مطابقة: مارس، أبريل، مايو 2026.
- كل جلسة تتكون من كشف الشركة وكشف المورد؛ كل كشف فيه 25 بنداً.
- إجمالي البنود المصدرية: 150 بنداً.
- ملف نتائج متوقعة مستقل للمراجع، ولا يُرفع للنظام.

## طريقة الاختبار

1. أنشئ مورداً تجريبياً بعملة واحدة، ثم جلسة لكل شهر.
2. ارفع ملف الشركة كـ «كشفنا» وملف المورد المقابل كـ «كشفهم».
3. قارن النتيجة مع «نتائج-متوقعة.csv» بعد إتمام المطابقة.
4. لا تعتمد المطابقة التجميعية أو فروقات الخصم/المرتجع/التوريد قبل مراجعة بشرية.

## الحالات المغطاة

- 16 فاتورة متطابقة لكل جلسة، منها اختلافات تاريخ مقصودة.
- 5 عمليات سداد متطابقة.
- قيد شركة تجميعي واحد مقابل 3 فواتير مورد.
- خصم لم يسجله المورد، مرتجع لم يسجله المورد، فاتورة شركة فقط، وفاتورة مورد قيد التوريد.
`;
writeFileSync(resolve(destination, 'README.md'), readme, 'utf8');

console.log(`Created demo reconciliation data in ${destination}`);
