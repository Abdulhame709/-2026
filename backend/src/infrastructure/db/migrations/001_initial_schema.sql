-- ============================================================================
-- 001_initial_schema.sql — المخطط الكامل المعتمد (وثيقة المعمارية Stage 2 §3)
-- نظام مطابقة كشوفات الحسابات — PostgreSQL
-- قواعد السلامة المالية: NUMERIC(18,4) بلا استثناء + قيد مركب يمنع خلط العملات
-- ============================================================================

-- ===== الأنواع المعددة =====
CREATE TYPE user_role          AS ENUM ('admin','reconciler','viewer');
CREATE TYPE partner_type       AS ENUM ('supplier','customer');          -- D6: v1 = supplier فقط
CREATE TYPE statement_side     AS ENUM ('ours','theirs');
CREATE TYPE statement_status   AS ENUM ('draft','validated','committed');
CREATE TYPE session_status     AS ENUM ('in_progress','closed','reopened');
CREATE TYPE match_rule         AS ENUM ('exact_ref','ref_map','description_ref','amount_date','manual');
CREATE TYPE discrepancy_type   AS ENUM ('amount_diff','date_diff','ref_diff','ours_only','theirs_only');
CREATE TYPE discrepancy_status AS ENUM ('new','in_progress','resolved','accepted');
CREATE TYPE ref_map_source     AS ENUM ('manual','auto_confirmed','auto_suggested');

-- ===== العملات المرجعية =====
CREATE TABLE currencies (
  code            char(3) PRIMARY KEY,
  name_ar         text    NOT NULL,
  symbol          text    NOT NULL,
  decimal_places  smallint NOT NULL DEFAULT 2 CHECK (decimal_places BETWEEN 0 AND 4),
  is_active       boolean NOT NULL DEFAULT true
);

-- ===== المستخدمون والجلسات =====
CREATE TABLE users (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username             text    NOT NULL,
  password_hash        text    NOT NULL,                   -- Argon2id
  full_name            text    NOT NULL,
  role                 user_role NOT NULL DEFAULT 'reconciler',
  is_active            boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  failed_attempts      smallint NOT NULL DEFAULT 0,
  locked_until         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_username ON users (lower(username));

CREATE TABLE auth_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  ip          inet,
  user_agent  text
);
CREATE INDEX ix_auth_sessions_user ON auth_sessions(user_id);

-- ===== الأطراف والحسابات =====
CREATE TABLE partners (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         text    NOT NULL UNIQUE,
  name_ar      text    NOT NULL,
  name_en      text,
  partner_type partner_type NOT NULL DEFAULT 'supplier',
  phone        text,
  email        text,
  notes        text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  partner_id       bigint  NOT NULL REFERENCES partners(id),
  currency_code    char(3) NOT NULL REFERENCES currencies(code),
  our_ledger_code  text,                                   -- رقم الحساب في أونكس برو
  date_window_days smallint NOT NULL DEFAULT 3 CHECK (date_window_days BETWEEN 0 AND 30),
  rule_order       text NOT NULL DEFAULT 'exact_ref,ref_map,description_ref,amount_date',
  is_active        boolean NOT NULL DEFAULT true,
  UNIQUE (partner_id, currency_code),
  UNIQUE (id, currency_code)                               -- لسلامة المرجع المركب أدناه
);

CREATE TABLE import_templates (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id        bigint REFERENCES accounts(id),        -- NULL = قالب كشوفنا (ONYX PRO)
  template_kind     text NOT NULL CHECK (template_kind IN ('ours','theirs')),
  name              text NOT NULL,
  header_rows       smallint NOT NULL DEFAULT 1,
  columns_mapping   jsonb NOT NULL,
  date_formats      jsonb NOT NULL DEFAULT '["YYYY-MM-DD","DD/MM/YYYY"]',
  decimal_sep       char(1) NOT NULL DEFAULT '.',
  thousand_sep      char(1) NOT NULL DEFAULT ',',
  is_default        boolean NOT NULL DEFAULT false,
  created_by        bigint REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ===== الملفات والكشوفات =====
CREATE TABLE source_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_name text NOT NULL,
  stored_path   text NOT NULL,                             -- خارج قاعدة البيانات
  mime_type     text,
  size_bytes    bigint,
  sha256        char(64) NOT NULL,
  uploaded_by   bigint REFERENCES users(id),
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_source_files_sha ON source_files(sha256);

CREATE TABLE statements (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id      bigint NOT NULL,
  currency_code   char(3) NOT NULL,
  side            statement_side NOT NULL,
  period_start    date,
  period_end      date,
  opening_balance numeric(18,4),
  closing_balance numeric(18,4),
  status          statement_status NOT NULL DEFAULT 'draft',
  source_file_id  uuid REFERENCES source_files(id),        -- NULL = إدخال يدوي
  ocr_applied     boolean NOT NULL DEFAULT false,
  created_by      bigint REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  committed_at    timestamptz,
  FOREIGN KEY (account_id, currency_code) REFERENCES accounts(id, currency_code)
  -- ✋ قيد مركّب: يستحيل مالياً أن ينزلق كشف لعملة حساب أخرى (Q11)
);
CREATE INDEX ix_statements_lookup ON statements(account_id, side, status);

CREATE TABLE statement_lines (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  statement_id    bigint NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  line_no         int    NOT NULL,
  entry_date      date   NOT NULL,
  description     text   NOT NULL,
  our_ref         text,
  their_ref       text,
  debit           numeric(18,4) CHECK (debit  IS NULL OR debit  >= 0),
  credit          numeric(18,4) CHECK (credit IS NULL OR credit >= 0),
  signed_amount   numeric(18,4) NOT NULL,
  running_balance numeric(18,4),
  extracted_refs  text[] NOT NULL DEFAULT '{}',
  ocr_confidence  numeric(4,3),
  needs_review    boolean NOT NULL DEFAULT false,
  UNIQUE (statement_id, line_no)
);
CREATE INDEX ix_lines_statement ON statement_lines(statement_id);
CREATE INDEX ix_lines_our_ref   ON statement_lines(our_ref) WHERE our_ref IS NOT NULL;
CREATE INDEX ix_lines_their_ref ON statement_lines(their_ref) WHERE their_ref IS NOT NULL;

-- ===== جلسات المطابقة والروابط =====
CREATE TABLE reconciliation_sessions (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id              bigint NOT NULL REFERENCES accounts(id),
  currency_code           char(3) NOT NULL,
  period_label            text NOT NULL,
  our_statement_id        bigint NOT NULL UNIQUE REFERENCES statements(id),
  their_statement_id      bigint NOT NULL UNIQUE REFERENCES statements(id),
  status                  session_status NOT NULL DEFAULT 'in_progress',
  opening_our_balance     numeric(18,4),
  opening_their_balance   numeric(18,4),
  carried_from_session_id bigint REFERENCES reconciliation_sessions(id),
  created_by              bigint REFERENCES users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  closed_at               timestamptz
);
CREATE INDEX ix_sessions_account ON reconciliation_sessions(account_id, status);

CREATE TABLE match_links (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  bigint NOT NULL REFERENCES reconciliation_sessions(id),
  rule        match_rule NOT NULL,
  confidence  numeric(4,3),
  is_active   boolean NOT NULL DEFAULT true,               -- الفك = إلغاء تفعيل (لا حذف)
  note        text,
  created_by  bigint REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deactivated_by   bigint REFERENCES users(id),
  deactivated_at   timestamptz
);
CREATE INDEX ix_matches_session ON match_links(session_id) WHERE is_active;

CREATE TABLE match_link_items (
  match_link_id bigint NOT NULL REFERENCES match_links(id) ON DELETE CASCADE,
  line_id       bigint NOT NULL REFERENCES statement_lines(id),
  PRIMARY KEY (match_link_id, line_id)
);
CREATE INDEX ix_match_items_line ON match_link_items(line_id);

-- ===== الأسباب والتسويات المبلَّغة =====
CREATE TABLE reason_codes (
  id         smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code       text NOT NULL UNIQUE,
  name_ar    text NOT NULL,
  name_en    text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE notified_adjustments (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id      bigint NOT NULL REFERENCES accounts(id),
  adjustment_date date   NOT NULL,
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('discount','return','other')),
  amount          numeric(18,4) NOT NULL,
  currency_code   char(3) NOT NULL REFERENCES currencies(code),
  note            text,
  created_by      bigint REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_notified_account ON notified_adjustments(account_id, adjustment_date);

-- ===== الفروق =====
CREATE TABLE discrepancies (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id             bigint NOT NULL REFERENCES reconciliation_sessions(id),
  discrepancy_type       discrepancy_type NOT NULL,
  our_line_id            bigint REFERENCES statement_lines(id),
  their_line_id          bigint REFERENCES statement_lines(id),
  our_amount             numeric(18,4),
  their_amount           numeric(18,4),
  diff_amount            numeric(18,4),
  reason_code_id         smallint REFERENCES reason_codes(id),
  notified_adjustment_id bigint REFERENCES notified_adjustments(id),
  assignee_id            bigint REFERENCES users(id),
  status                 discrepancy_status NOT NULL DEFAULT 'new',
  resolution_note        text,
  carried_to_session_id  bigint REFERENCES reconciliation_sessions(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at            timestamptz,
  CHECK (our_line_id IS NOT NULL OR their_line_id IS NOT NULL)
);
CREATE INDEX ix_disc_session ON discrepancies(session_id, status);

CREATE TABLE discrepancy_comments (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  discrepancy_id  bigint NOT NULL REFERENCES discrepancies(id) ON DELETE CASCADE,
  author_id       bigint NOT NULL REFERENCES users(id),
  comment         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ===== خريطة المراجع =====
CREATE TABLE ref_map_entries (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id    bigint NOT NULL REFERENCES accounts(id),
  our_ref       text NOT NULL,
  their_ref     text NOT NULL,
  source        ref_map_source NOT NULL DEFAULT 'manual',
  confirmed_by  bigint REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, our_ref, their_ref)
);
CREATE INDEX ix_refmap_lookup  ON ref_map_entries(account_id, our_ref);
CREATE INDEX ix_refmap_lookup2 ON ref_map_entries(account_id, their_ref);

-- ===== سجل التدقيق (إلحاق فقط) =====
CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    bigint REFERENCES users(id),
  action      text NOT NULL,
  entity_type text,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX ix_audit_time   ON audit_log(created_at);

-- ===== الإعدادات =====
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by bigint REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
