-- Budgeto: totals come only from card charges and manual entries (one_offs rows).
-- The typed amount per line item per month (monthly_amounts) is retired: every stored
-- amount becomes a manual entry on the same line item, so history and totals don't change.
-- Run in the shared project's SQL Editor after 20261022000000_card_category.sql.
--
-- monthly_amounts and line_items.recurrence/default_amount are left in place (unused).

BEGIN;

-- "Repeats monthly": the Month page offers to copy last month's repeating entries
ALTER TABLE budgeto.one_offs ADD COLUMN repeats boolean NOT NULL DEFAULT false;

INSERT INTO budgeto.one_offs (user_id, name, amount, month, category_id, line_item_id, note, repeats, created_at)
SELECT a.user_id, li.name, a.amount, a.month, li.category_id, li.id, a.note, li.recurrence <> 'none', a.created_at
FROM budgeto.monthly_amounts a
JOIN budgeto.line_items li ON li.id = a.line_item_id
-- A typed 0 only meant "nothing this month"; keep it only if it carries a note
WHERE a.amount > 0 OR a.note IS NOT NULL;

DELETE FROM budgeto.monthly_amounts;

COMMIT;

-- Make the Data API pick up the new column immediately
NOTIFY pgrst, 'reload schema';
