-- ============================================================================
-- 002_module4_matching.sql — تطويرات الوحدة 4 (المطابقة) فوق المخطط المعتمد
-- 1) الجلسة تُنشأ أولاً (خطوة 1 في المعالج) وترتبط بها الكشوفات عند اعتمادها
-- 2) حالات الربط: اقتراح آلي ← مؤكد؛ والرفض/الفك = إلغاء تفعيل محفوظ (تدقيق + منع التكرار)
-- 3) التوزيع الجزئي (دفعة ↔ عدة فواتير): حصة كل بند — NULL = كامل المبلغ الموقّع
-- قابلة لإعادة التطبيق (حراس وجود) — آمنة على قاعدة مطبقة جزئياً
-- ============================================================================

-- الجلسة تبدأ بلا كشوفات (المعالج ينشئها في الخطوة 1)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='reconciliation_sessions' AND column_name='our_statement_id' AND is_nullable='NO') THEN
    ALTER TABLE reconciliation_sessions ALTER COLUMN our_statement_id DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='reconciliation_sessions' AND column_name='their_statement_id' AND is_nullable='NO') THEN
    ALTER TABLE reconciliation_sessions ALTER COLUMN their_statement_id DROP NOT NULL;
  END IF;
END $$;

-- حالة الربط + بصمة الاقتراح (لمنع إعادة اقتراح ما رفضه المستخدم)
ALTER TABLE match_links ADD COLUMN IF NOT EXISTS status  text NOT NULL DEFAULT 'suggested';
ALTER TABLE match_links ADD COLUMN IF NOT EXISTS pair_key text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='match_links_status_check') THEN
    ALTER TABLE match_links ADD CONSTRAINT match_links_status_check
      CHECK (status IN ('suggested','confirmed'));
  END IF;
END $$;

-- حصة التوزيع الجزئي (دفعة ↔ عدة فواتير)
ALTER TABLE match_link_items ADD COLUMN IF NOT EXISTS allocated numeric(18,4);

-- ملخص الإغلاق (نسب المطابقة والفروق المتبقية وقت الإغلاق) — لقطة للتوثيق
ALTER TABLE reconciliation_sessions ADD COLUMN IF NOT EXISTS close_summary jsonb;
