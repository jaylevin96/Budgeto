-- Budgeto round 3: Amex statement import.
-- Run in the shared project's SQL Editor after 20261020000000_one_offs_budgets.sql.
--
-- Card transactions are stored one per row and added on top of what's typed, like linked
-- one-offs. Imports never write to monthly_amounts, so typed amounts are never overwritten.
-- Each charge counts exactly once, in one of these ways:
--   line_item_id set               → adds to that line item's month total
--   neither line item nor one-off  → "Uncategorized" spending until it's filed
--   one_off_id set                 → covered by that one-off (the one-off's amount counts instead)
--   excluded                       → not counted (card payments, "don't count")

-- one_offs gets a composite key so card transactions can reference the same user's one-offs
ALTER TABLE budgeto.one_offs ADD CONSTRAINT one_offs_id_user_id_key UNIQUE (id, user_id);

-- One uploaded statement file. Deleting it undoes the import: its transactions, and any
-- one-offs created from them, go with it.
CREATE TABLE budgeto.imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('amex')),
  account_label text,
  period_start date,
  period_end date,
  file_name text,
  row_count integer NOT NULL DEFAULT 0,
  -- Net of counted (non-excluded) rows, for the import history list
  total numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);

CREATE INDEX idx_imports_user_created ON budgeto.imports(user_id, created_at DESC);

-- One-offs made from card charges on the review screen belong to that import
ALTER TABLE budgeto.one_offs ADD COLUMN import_id uuid;
ALTER TABLE budgeto.one_offs
  ADD CONSTRAINT one_offs_import_fk FOREIGN KEY (import_id, user_id)
  REFERENCES budgeto.imports(id, user_id) ON DELETE CASCADE;

-- Individual card transactions. month comes from posted_on (the transaction date),
-- so one statement can span two budget months.
CREATE TABLE budgeto.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  import_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('amex')),
  -- Amex "Reference": unique per transaction, so re-uploading a statement adds nothing
  external_id text NOT NULL,
  posted_on date NOT NULL,
  month date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  description text NOT NULL,
  -- Normalized merchant name; merchant rules match on this
  merchant text NOT NULL,
  card_member text,
  -- Amex's own category, e.g. 'Restaurant-Restaurant'
  source_category text,
  -- Charges positive, credits and refunds negative
  amount numeric(12, 2) NOT NULL,
  line_item_id uuid,
  one_off_id uuid,
  excluded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source, external_id),
  FOREIGN KEY (import_id, user_id) REFERENCES budgeto.imports(id, user_id) ON DELETE CASCADE,
  -- Deleting a line item or one-off puts its charges back to uncategorized (still counted)
  FOREIGN KEY (line_item_id, user_id) REFERENCES budgeto.line_items(id, user_id) ON DELETE SET NULL (line_item_id),
  FOREIGN KEY (one_off_id, user_id) REFERENCES budgeto.one_offs(id, user_id) ON DELETE SET NULL (one_off_id)
);

CREATE INDEX idx_transactions_user_month ON budgeto.transactions(user_id, month);
CREATE INDEX idx_transactions_import_id ON budgeto.transactions(import_id);
CREATE INDEX idx_transactions_line_item_id ON budgeto.transactions(line_item_id);
CREATE INDEX idx_transactions_one_off_id ON budgeto.transactions(one_off_id);

-- Learned categorization: "file this merchant (or Amex category) under this line item",
-- or "never count it". Saved from the review screen's "remember" choice.
CREATE TABLE budgeto.merchant_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  match_type text NOT NULL CHECK (match_type IN ('merchant', 'source_category')),
  pattern text NOT NULL CHECK (length(trim(pattern)) > 0),
  line_item_id uuid,
  exclude boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, match_type, pattern),
  CHECK (exclude OR line_item_id IS NOT NULL),
  FOREIGN KEY (line_item_id, user_id) REFERENCES budgeto.line_items(id, user_id) ON DELETE CASCADE
);

CREATE TRIGGER transactions_updated_at BEFORE UPDATE ON budgeto.transactions
  FOR EACH ROW EXECUTE FUNCTION budgeto.set_updated_at();
CREATE TRIGGER merchant_rules_updated_at BEFORE UPDATE ON budgeto.merchant_rules
  FOR EACH ROW EXECUTE FUNCTION budgeto.set_updated_at();

GRANT ALL ON budgeto.imports, budgeto.transactions, budgeto.merchant_rules TO anon, authenticated, service_role;

ALTER TABLE budgeto.imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgeto.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgeto.merchant_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own imports" ON budgeto.imports
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own transactions" ON budgeto.transactions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own merchant rules" ON budgeto.merchant_rules
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Make the Data API pick up the new tables/columns immediately
NOTIFY pgrst, 'reload schema';
