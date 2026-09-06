-- 002_reference_data.sql — بيانات مرجعية أساسية (لا بيانات تجريبية هنا)
INSERT INTO currencies (code, name_ar, symbol, decimal_places) VALUES
  ('YER', 'ريال يمني', 'ر.ي', 2),
  ('USD', 'دولار أمريكي', '$', 2),
  ('SAR', 'ريال سعودي', 'ر.س', 2)
ON CONFLICT (code) DO NOTHING;

INSERT INTO reason_codes (code, name_ar, name_en, sort_order) VALUES
  ('NOTIFIED_DISCOUNT_NOT_APPLIED', 'خصم مُبلَّغ لم يُطبَّق عنده', 'Notified discount not applied', 1),
  ('UNRECORDED_RETURN',             'مرتجع غير مقيَّد عنده',     'Unrecorded return',            2),
  ('PAYMENT_NOT_IN_THEIR_STATEMENT','دفعة مسجلة عندنا وغير موجودة عنده', 'Payment missing in their statement', 3),
  ('PAYMENT_NOT_IN_OUR_LEDGER',     'دفعة عنده وغير مسجلة عندنا', 'Payment missing in our ledger', 4),
  ('UNRECORDED_INVOICE',            'فاتورة لم تُقيَّد عندنا',    'Unrecorded invoice',           5),
  ('ENTRY_ERROR',                   'خطأ إدخال (رقم/مبلغ)',       'Entry error',                  6),
  ('PERIOD_CUTOFF',                 'فرق إقفال/تقويم فترات',      'Period cut-off difference',    7),
  ('OTHER',                         'أخرى',                        'Other',                        8)
ON CONFLICT (code) DO NOTHING;
