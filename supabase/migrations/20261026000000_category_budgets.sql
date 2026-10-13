-- Budgeto: monthly budgets per category, with a start month.
-- Run in the shared project's SQL Editor after 20261025000000_recurring_amount_varies.sql.
--
-- A category's budget is a list of changes: "$600 from the start", "$800 from Oct 2026".
-- A month uses the latest change starting on or before it, so changing a budget never
-- rewrites earlier months. amount NULL means "no budget from this month".
--
-- Budgets are per category only. Existing category budgets carry over as starting from the
-- beginning (so nothing shown today changes). line_items.monthly_budget is no longer used
-- by the app; it's left in place so no data is lost.

BEGIN;

CREATE TABLE budgeto.category_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  amount numeric(12, 2) CHECK (amount IS NULL OR amount >= 0),
  start_month date NOT NULL CHECK (EXTRACT(DAY FROM start_month) = 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, start_month),
  FOREIGN KEY (category_id, user_id) REFERENCES budgeto.categories(id, user_id) ON DELETE CASCADE
);

CREATE INDEX idx_category_budgets_user ON budgeto.category_budgets(user_id);

CREATE TRIGGER category_budgets_updated_at BEFORE UPDATE ON budgeto.category_budgets
  FOR EACH ROW EXECUTE FUNCTION budgeto.set_updated_at();

GRANT ALL ON budgeto.category_budgets TO anon, authenticated, service_role;

ALTER TABLE budgeto.category_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own category budgets" ON budgeto.category_budgets
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- "From the start": earlier than any month the app shows
INSERT INTO budgeto.category_budgets (user_id, category_id, amount, start_month)
SELECT user_id, id, monthly_budget, DATE '2000-01-01'
FROM budgeto.categories
WHERE monthly_budget IS NOT NULL;

ALTER TABLE budgeto.categories DROP COLUMN monthly_budget;

COMMIT;

-- Make the Data API pick up the changes immediately
NOTIFY pgrst, 'reload schema';
