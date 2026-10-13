-- Budgeto: recurring entries whose amount changes every month (utilities, childcare).
-- Run in the shared project's SQL Editor after 20261024000000_recurring_entries.sql.
--
-- amount_varies = false: the same amount is filled in automatically every month (rent, wages).
-- amount_varies = true:  each month is expected but not filled in; the Month page asks for the
--                        amount ("Needs an amount", with last month's as a hint).

BEGIN;

ALTER TABLE budgeto.recurring_entries ADD COLUMN amount_varies boolean NOT NULL DEFAULT false;

-- Mark as varying: entries on a line item set to "monthly, amount varies", and entries whose
-- months haven't all had the same amount
UPDATE budgeto.recurring_entries r
SET amount_varies = true
WHERE EXISTS (SELECT 1 FROM budgeto.line_items li WHERE li.id = r.line_item_id AND li.recurrence = 'variable')
   OR (SELECT count(DISTINCT o.amount) FROM budgeto.one_offs o WHERE o.recurring_id = r.id) > 1;

-- Remove the months the app filled in automatically for those (copies of the template amount,
-- never edited), so they come back as "Needs an amount" instead of a made-up figure. The first
-- month and anything that existed before the recurring entry are kept.
DELETE FROM budgeto.one_offs o
USING budgeto.recurring_entries r
WHERE o.recurring_id = r.id
  AND r.amount_varies
  AND o.month > r.start_month
  AND o.created_at > r.created_at
  AND o.updated_at = o.created_at
  AND o.amount = r.amount;

COMMIT;

NOTIFY pgrst, 'reload schema';
