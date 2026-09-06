/**
 * تفقيط المبالغ بالعربية — منقول حرفياً من منطق الواجهة المعتمد (reportsClient)
 * كي يبقى التقرير المطبوع من المتصفح والمولَّد خادمياً بنص واحد.
 */

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

const groupNames: Array<[number, string, string, string]> = [
  [1_000_000_000, 'مليار', 'ملياراً', 'مليارات'],
  [1_000_000, 'مليون', 'مليوناً', 'ملايين'],
  [1_000, 'ألف', 'ألفاً', 'آلاف'],
];

const CURRENCY_NAMES: Record<'YER' | 'USD' | 'SAR', string> = {
  YER: 'ريال يمني',
  USD: 'دولار أمريكي',
  SAR: 'ريال سعودي',
};

const threeDigits = (n: number): string => {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const ones = rest % 10;
      const tens = Math.floor(rest / 10);
      parts.push(ones ? `${ONES[ones]} و${TENS[tens]}` : TENS[tens]);
    }
  }
  return parts.join(' و');
};

export function tafqitInteger(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'صفر';
  const parts: string[] = [];
  for (const [scale, one, two, plural] of groupNames) {
    const count = Math.floor(n / scale);
    if (!count) continue;
    n %= scale;
    if (count === 1) parts.push(one);
    else if (count === 2) parts.push(two);
    else if (count >= 3 && count <= 10) parts.push(`${threeDigits(count)} ${plural}`);
    else parts.push(`${threeDigits(count)} ${one}`);
  }
  if (n) parts.push(threeDigits(n));
  return parts.join(' و');
}

/** تفقيط مبلغ بعملته — «فقط خمسة وثلاثون ألف ريال يمني و 50/100 لا غير» */
export function tafqitAmount(amount: number, currency: 'YER' | 'USD' | 'SAR'): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.floor(abs);
  const fraction = Math.round((abs - whole) * 100);
  const base = `${tafqitInteger(whole)} ${CURRENCY_NAMES[currency]}`;
  const frac = fraction ? ` و ${fraction}/100` : '';
  return `فقط ${negative ? 'سالب ' : ''}${base}${frac} لا غير`;
}

export { CURRENCY_NAMES };
