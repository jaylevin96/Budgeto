-- Budgeto: recurring manual entries (rent, wages, subscriptions).
-- Run in the shared project's SQL Editor after 20261023000000_manual_entries_only.sql.
--
-- A recurring entry is a template. Each month from start_month through end_month (or the
-- current month when open-ended) gets a real manual entry (one_offs row) linked by
-- recurring_id, except months listed in skip_months. The app creates missing months when it
-- loads, never months in the future. Editing "this month", "this and later" or "all months"
-- changes the linked rows and/or the template.

BEGIN;

CREATE TABLE budgeto.recurring_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  category_id uuid NOT NULL,
  line_item_id uuid,
  note text,
  start_month date NOT NULL CHECK (EXTRACT(DAY FROM start_month) = 1),
  end_month date CHECK (end_month IS NULL OR (EXTRACT(DAY FROM end_month) = 1 AND end_month >= start_month)),
  skip_months date[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  FOREIGN KEY (category_id, user_id) REFERENCES budgeto.categories(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (line_item_id, user_id) REFERENCES budgeto.line_items(id, user_id) ON DELETE SET NULL (line_item_id)
);

CREATE INDEX idx_recurring_entries_user ON budgeto.recurring_entries(user_id);

CREATE TRIGGER recurring_entries_updated_at BEFORE UPDATE ON budgeto.recurring_entries
  FOR EACH ROW EXECUTE FUNCTION budgeto.set_updated_at();

GRANT ALL ON budgeto.recurring_entries TO anon, authenticated, service_role;

ALTER TABLE budgeto.recurring_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own recurring entries" ON budgeto.recurring_entries
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Each month's occurrence; deleting the recurring entry deletes all of them
ALTER TABLE budgeto.one_offs ADD COLUMN recurring_id uuid;
ALTER TABLE budgeto.one_offs
  ADD CONSTRAINT one_offs_recurring_fk FOREIGN KEY (recurring_id, user_id)
  REFERENCES budgeto.recurring_entries(id, user_id) ON DELETE CASCADE;
ALTER TABLE budgeto.one_offs ADD CONSTRAINT one_offs_recurring_month UNIQUE (recurring_id, month);

-- Turn entries marked "repeats monthly" into recurring entries: one per
-- (user, category, line item, name). It stays open-ended if it appeared last month or later;
-- otherwise it ends at its last month so an old subscription doesn't come back.
CREATE TEMP TABLE repeat_groups ON COMMIT DROP AS
SELECT
  user_id,
  category_id,
  line_item_id,
  lower(trim(name)) AS key,
  min(month) AS first_month,
  max(month) AS last_month,
  gen_random_uuid() AS recurring_id
FROM budgeto.one_offs
WHERE repeats AND category_id IS NOT NULL
GROUP BY user_id, category_id, line_item_id, lower(trim(name));

INSERT INTO budgeto.recurring_entries (id, user_id, name, amount, category_id, line_item_id, note, start_month, end_month, skip_months)
SELECT
  g.recurring_id,
  g.user_id,
  latest.name,
  latest.amount,
  g.category_id,
  g.line_item_id,
  latest.note,
  g.first_month,
  CASE WHEN g.last_month >= (date_trunc('month', now()) - interval '1 month')::date THEN NULL ELSE g.last_month END,
  ARRAY(
    SELECT m::date
    FROM generate_series(g.first_month, g.last_month, interval '1 month') AS m
    WHERE NOT EXISTS (
      SELECT 1 FROM budgeto.one_offs o
      WHERE o.repeats AND o.user_id = g.user_id AND o.category_id = g.category_id
        AND o.line_item_id IS NOT DISTINCT FROM g.line_item_id
        AND lower(trim(o.name)) = g.key AND o.month = m::date
    )
  )
FROM repeat_groups g
CROSS JOIN LATERAL (
  SELECT o.name, o.amount, o.note
  FROM budgeto.one_offs o
  WHERE o.repeats AND o.user_id = g.user_id AND o.category_id = g.category_id
    AND o.line_item_id IS NOT DISTINCT FROM g.line_item_id
    AND lower(trim(o.name)) = g.key
  ORDER BY o.month DESC, o.created_at DESC
  LIMIT 1
) latest;

-- Link each month's row (the first one, if a month has two)
UPDATE budgeto.one_offs o
SET recurring_id = pick.recurring_id
FROM (
  SELECT DISTINCT ON (g.recurring_id, o2.month) o2.id, g.recurring_id
  FROM repeat_groups g
  JOIN budgeto.one_offs o2
    ON o2.repeats AND o2.user_id = g.user_id AND o2.category_id = g.category_id
   AND o2.line_item_id IS NOT DISTINCT FROM g.line_item_id
   AND lower(trim(o2.name)) = g.key
  ORDER BY g.recurring_id, o2.month, o2.created_at
) pick
WHERE o.id = pick.id;

ALTER TABLE budgeto.one_offs DROP COLUMN repeats;

COMMIT;

-- Make the Data API pick up the changes immediately
NOTIFY pgrst, 'reload schema';
