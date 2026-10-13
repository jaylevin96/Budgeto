-- Budgeto round 2: one-off purchases and monthly budgets.
-- Run in the shared project's SQL Editor after 20261013000000_budgeto_schema.sql.

-- Bigger one-time purchases ("Miami flights", "New PlayStation").
-- Optionally tied to a category and/or a line item; untied ones count as spending.
--   line_item_id set → adds to that item's month total
--   category_id only → shows as a "One-offs" row in that category
--   neither          → "Uncategorized one-offs"
CREATE TABLE budgeto.one_offs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  month date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  category_id uuid,
  line_item_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- composite FKs: links can only point at the same user's rows (NULL skips the check)
  FOREIGN KEY (category_id, user_id) REFERENCES budgeto.categories(id, user_id) ON DELETE SET NULL (category_id),
  FOREIGN KEY (line_item_id, user_id) REFERENCES budgeto.line_items(id, user_id) ON DELETE SET NULL (line_item_id)
);

CREATE INDEX idx_one_offs_user_month ON budgeto.one_offs(user_id, month);

CREATE TRIGGER one_offs_updated_at BEFORE UPDATE ON budgeto.one_offs
  FOR EACH ROW EXECUTE FUNCTION budgeto.set_updated_at();

GRANT ALL ON budgeto.one_offs TO anon, authenticated, service_role;

ALTER TABLE budgeto.one_offs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own one-offs" ON budgeto.one_offs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Optional monthly targets
ALTER TABLE budgeto.categories
  ADD COLUMN monthly_budget numeric(12, 2) CHECK (monthly_budget IS NULL OR monthly_budget >= 0);
ALTER TABLE budgeto.line_items
  ADD COLUMN monthly_budget numeric(12, 2) CHECK (monthly_budget IS NULL OR monthly_budget >= 0);

-- Make the Data API pick up the new table/columns immediately
NOTIFY pgrst, 'reload schema';
