-- Budgeto: recurring entries that come every few months (car insurance in Feb and Aug, annual fees).
-- Run in the shared project's SQL Editor after 20261026000000_category_budgets.sql.
--
-- every_months = 1 is monthly (every existing entry). Due months are counted from start_month:
-- start_month, start_month + every_months, and so on, through end_month.

BEGIN;

ALTER TABLE budgeto.recurring_entries
  ADD COLUMN every_months smallint NOT NULL DEFAULT 1 CHECK (every_months BETWEEN 1 AND 12);

COMMIT;

-- Make the Data API pick up the changes immediately
NOTIFY pgrst, 'reload schema';
