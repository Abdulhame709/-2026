#!/bin/bash
# فحص فوري لأي ملف PDF على المحرك الحي — تشخيص كامل في أمر واحد
# الاستخدام: bash diagnose-pdf.sh <مسار-الملف.pdf>
F="$1"
B="${B:-http://127.0.0.1:3000/api/v1}"
JAR="${JAR:-/tmp/final.txt}"
[ -f "$F" ] || { echo "✗ الملف غير موجود: $F"; exit 1; }

echo "═══ 1) تشريح الملف ═══"
echo "الحجم: $(stat -c%s "$F") بايت"
head -c 5 "$F" | grep -q '%PDF-' && echo "الترويسة: %PDF- ✓" || echo "الترويسة: ✗ ليست PDF!"
grep -aq "/Encrypt" "$F" && echo "التشفير: نعم ⚠" || echo "التشفير: لا"
grep -ao "BaseFont /[A-Za-z0-9+,-]*" "$F" | sort -u | head -6

echo ""
echo "═══ 2) الاختبار على المحرك الحي ═══"
R=$(curl -s -m 120 -b "$JAR" -X POST -F "file=@$F" "$B/statements/ocr")
echo "$R" | python3 -c "
import json, sys
raw = sys.stdin.read()
try:
    d = json.loads(raw); dr = d.get('draft', d)
    ls = dr.get('lines', [])
    print(f'الوضع: {dr.get(\"mode\")} · صفحات: {dr.get(\"pages\")} · بنود: {len(ls)} · افتتاحي: {dr.get(\"opening\")}')
    for l in ls[:6]:
        print('  بند', l['lineNo'], '·', l.get('dateRaw'), '·', (l.get('description') or '')[:28], '· د:', l.get('debitRaw') or '-', '· ح:', l.get('creditRaw') or '-', '· ثقة:', l.get('ocrConfidence'))
    if len(ls) > 6: print(f'  … و{len(ls)-6} بنوداً أخرى')
except Exception:
    try:
        e = json.loads(raw)['error']
        print(f'رفض 422: {e[\"details\"][0][\"messageAr\"]}')
    except Exception:
        print('استجابة غير متوقعة:', raw[:300])"
