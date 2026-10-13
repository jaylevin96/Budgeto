-- Budgeto: let a card charge be filed to a category without a specific line item,
-- the same way an entry (one_offs row) can be.
-- Run in the shared project's SQL Editor after 20261021000000_card_import.sql.
--
-- Where a counted charge goes (first that applies):
--   line_item_id set  → adds to that line item's month total
--   category_id set   → shows in that category's "Entries" row and adds to the category
--   neither           → "Uncategorized" spending until it's filed

ALTER TABLE budgeto.transactions ADD COLUMN category_id uuid;

-- Deleting the category puts its charges back to uncategorized (still counted)
ALTER TABLE budgeto.transactions
  ADD CONSTRAINT transactions_category_fk FOREIGN KEY (category_id, user_id)
  REFERENCES budgeto.categories(id, user_id) ON DELETE SET NULL (category_id);

CREATE INDEX idx_transactions_category_id ON budgeto.transactions(category_id);

-- Make the Data API pick up the new column immediately
NOTIFY pgrst, 'reload schema';
