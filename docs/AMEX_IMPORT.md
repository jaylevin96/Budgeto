# Amex statement import — plan

> **Built (Oct 2026). These decisions override the sections below:**
> - **Combined with one-offs.** Card charges go through the same Ledger as one-offs. A charge is filed under a line item (adds to that cell), left unfiled (counts as **Uncategorized** spending, like an untied one-off, rather than being ignored), linked to a one-off (`transactions.one_off_id`: the one-off's amount counts, the charge doesn't), or excluded. Each charge counts exactly once.
> - **Purchases already typed as one-offs are detected.** On review, a same-month one-off whose amount matches one charge, or the sum of one merchant's charges (±1% or $1), is pre-linked. For example, "Cabo hotel" $5,342 is linked to Palace Resorts $4,828 + $514.
> - **Making one-offs from charges.** Charges of $500 or more start out ticked **One-off**. On import, ticked charges become one one-off per merchant per month, filed where the charge was going. `one_offs.import_id` is set so **Undo import** removes those one-offs too. Deleting a one-off sets its charges' `one_off_id` to null, so they count on their own again.
> - **Typed-amount clash warning** when a charge lands on a cell that already has a typed amount that month. Items with card charges don't get a "Fill recurring" suggestion.
> - Schema: `supabase/migrations/20261021000000_card_import.sql`. Code: `src/lib/amex.ts` (parse + categorize), `src/lib/cardReview.ts` (one-off matching), `src/lib/transactions.ts` (data access), `src/pages/CardImport.tsx`, `src/components/CardTransactions.tsx`. The Month page, Year grid, Dashboard and export all read card charges through the Ledger in `src/lib/budget.ts`.

Upload the American Express "Transaction Details" export once a month. The app files each charge under a budget line item and adds the totals to the Month and Year views. After the first month or two, an upload should need few or no clicks.

## 1. What the Amex file contains

The file is `activity.xlsx`, exported from americanexpress.com → Statements & Activity → Download → Excel. It has two sheets.

**Transaction Details**
- Rows 1–6 are a header block. `B1` = `American Express Gold Card / Aug 26, 2026 to Sep 24, 2026`, which gives the card name and the statement period. `A5` = masked account number.
- Row 7 holds the column headers: `Date | Description | Card Member | Account # | Amount | Extended Details | Appears On Your Statement As | Address | City/State | Zip Code | Country | Reference | Category`.
- Row 8 onward holds one row per transaction (45 in the sample).
  - `Date` is a **string** `MM/DD/YYYY`, not an Excel date.
  - `Amount`: positive = charge, negative = credit or payment.
  - `Reference` is unique per transaction (18 digits) and is the de-duplication key.
  - `Category` is Amex's own category, `Group-Subcategory`, for example `Restaurant-Restaurant` or `Travel-Lodging`. It is blank for payments.
  - `Card Member`: JAY LEVIN (-41000) or JILLIAN MIZRAJI (-41018).

**Transaction Summary**: previous balance, payments and credits, charges, statement balance, plus a per-card-member split. The import uses this to check its own totals.

Sample, Aug 26 – Sep 24 2026:

| Kind | Rows | Total |
|---|---|---|
| Charges | 41 | $8,514.83 (matches Summary "Charges") |
| Autopay payment | 1 | −$7,846.00 → **skip** (it's a transfer, not spending) |
| Amex Split credits (Venmo) | 2 | −$128.46 → reimbursements, reduce the original line |
| Merchant refund (Cabo Dolphins) | 1 | −$195.00 → reduces its line |

Charges by Amex category: Travel-Lodging $5,358 · Restaurant $901 + Bar & Café $64 · Furnishing $590 · Vehicle Rental $384 · Internet Purchase $281 · Other Transportation $251 · Taxis $219 · Groceries $74 · Pharmacies $48 · Cable & Internet $43 · …

## 2. The core design problem

Budgeto stores **one total per line item per month** (`monthly_amounts`), and those totals are typed in by hand. Amex is only one source of spending. "Dining out" also includes debit-card and Venmo spending that gets typed in. So the import **must not overwrite** the cell.

**Decision: store Amex transactions separately, and show cell = manual amount + card total.**

- New table `transactions` holds the raw imported rows.
- `monthly_amounts` stays the hand-entered part, with no changes.
- The app adds the two together when it reads the data. Each cell on the Month page shows its manual input plus a read-only line, "+ $412.18 from Amex (9)", which opens the list of those transactions.
- Re-importing an overlapping statement is safe because rows de-duplicate on `Reference`.
- Deleting an import (a bad upload) removes only its rows.

This also lays the groundwork for a Chase or bank CSV import later. Phase 3 of PLAN.md already mentions one, and a new importer would only need a new parser.

Option considered and rejected: write Amex totals straight into `monthly_amounts`. It clobbers manual entries, a second import can't tell its earlier total from hand-typed money, and individual charges can't be audited.

## 3. Which month a transaction belongs to

**Use the transaction date, not the statement.** A statement running Aug 26 – Sep 24 puts 17 rows in August and 28 in September. The rest of September arrives with the next statement. This matches how the spreadsheet treats months and keeps the year-over-year numbers honest. Because rows de-duplicate, uploading statements in any order, or twice, is harmless.

The import screen shows a note such as "September is partial until the Oct statement is imported", based on which months the statement period only partly covers.

## 4. Schema (new migration)

```sql
-- One upload of a statement file
CREATE TABLE budgeto.imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL,                 -- 'amex'
  account_label text,                   -- 'American Express Gold Card'
  period_start date, period_end date,
  file_name text,
  row_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);

-- Individual card transactions
CREATE TABLE budgeto.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  import_id uuid NOT NULL,
  source text NOT NULL,                 -- 'amex'
  external_id text NOT NULL,            -- Amex Reference
  posted_on date NOT NULL,
  month date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  description text NOT NULL,
  merchant text NOT NULL,               -- normalized, see §5
  card_member text,
  source_category text,                 -- Amex 'Restaurant-Restaurant'
  amount numeric(12,2) NOT NULL,        -- charges +, credits −  (no >= 0 check)
  line_item_id uuid,                    -- null = uncategorized
  excluded boolean NOT NULL DEFAULT false,  -- payments, transfers, "don't count"
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source, external_id),
  FOREIGN KEY (import_id, user_id) REFERENCES budgeto.imports(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (line_item_id, user_id) REFERENCES budgeto.line_items(id, user_id) ON DELETE SET NULL (line_item_id)
);
CREATE INDEX idx_transactions_user_month ON budgeto.transactions(user_id, month);

-- Learned "this merchant → this line item" rules
CREATE TABLE budgeto.merchant_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  match_type text NOT NULL CHECK (match_type IN ('merchant', 'source_category')),
  pattern text NOT NULL,                -- normalized merchant or 'Restaurant-Restaurant'
  line_item_id uuid,                    -- null + exclude = always skip
  exclude boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, match_type, pattern),
  FOREIGN KEY (line_item_id, user_id) REFERENCES budgeto.line_items(id, user_id) ON DELETE CASCADE
);
```

Each table also gets RLS policies (`auth.uid() = user_id`), grants, and the `updated_at` trigger, following the existing migration.

## 5. Categorizing (what makes it "auto")

For each row, apply the first matching rule:

1. **Built-in exclusions.** Descriptions matching `AUTOPAY PAYMENT`, `PAYMENT - THANK YOU`, or `ONLINE PAYMENT` → `excluded = true`.
2. **Merchant rule.** Look up the normalized merchant in `merchant_rules`. Normalizing means:
   - strip the `AplPay ` and `TST* ` / `SQ *` / `VCN*` prefixes,
   - take the merchant name from line 2 of `Extended Details` when present (it isn't truncated like `Description`),
   - drop store numbers and trailing city/state, then uppercase.

   For example, `AplPay TST* TANUKI SCHICAGO IL` → `TANUKI SUSHI`.
3. **Amex category rule.** Look up `source_category` in `merchant_rules`. Defaults seeded on first import:

   | Amex category | Line item |
   |---|---|
   | Restaurant-* | Daily Living › Dining out |
   | Merchandise & Supplies-Groceries | Daily Living › Groceries |
   | Travel-Lodging | Vacations › Accommodations |
   | Travel-Airline | Vacations › Plane fare |
   | Travel-Vehicle Rental | Vacations › Rental car |
   | Transportation-Fuel | Transportation › Gas/fuel |
   | Communications-Cable & Internet Comm | Entertainment › Cable TV |
   | Entertainment-* | Entertainment › Concerts/clubs |
   | Merchandise & Supplies-Clothing Stores | Personal › Clothing |
   | everything else | uncategorized → user picks |

4. **Amex Split credits** (`Amex Split Credit: Venmo-…`) are friends paying back their share of a meal. The Extended Details include the original merchant (`TANUKI SUSHI GRILL`). Match that merchant to the original charge and use the same line item, so Dining out shows the net cost. If no charge matches, the row stays uncategorized.
5. **Refunds** (other negative amounts) go through the same rules, so they land on the same line as the purchase.

When the user picks a line item for an uncategorized row on the review screen, a **"Always file <merchant> here"** checkbox (on by default) saves a merchant rule. Month 2 onward should be mostly pre-filled.

## 6. Import flow (UI)

Route `/import/card`, linked from Settings and from a "Import Amex statement" button on the Month page.

1. **Upload.** Pick a `.xlsx` or `.csv` file; it's parsed in the browser with the `xlsx` package already in deps. Detect the Amex format by finding the header row that contains `Date`, `Description`, `Amount`, `Reference`, `Category`, so slight layout changes and the Amex CSV export both work. Read the period from `B1`.
2. **Check.** Sum the parsed charges and credits, then compare them with the Transaction Summary sheet. Show ✓ or a warning. Flag rows whose `Reference` is already imported ("12 already imported, will be skipped").
3. **Review.** The table is grouped by month, then by line item:
   - The **Uncategorized** group sits at the top with a line-item dropdown on each row, plus the "always" checkbox.
   - Each row can also be changed, or marked "Don't count", for example a purchase that is really a work expense.
   - A filter by card member (Jay / Jillian).
   - Per-line totals, plus the resulting month totals.
4. **Import.** Insert one `imports` row and the new `transactions` rows, and upsert any new merchant rules. Show "Added $X across N line items for Aug and Sep" with links to those months.

The Import history (Settings) lists each import with its period and total, and offers **Undo import**, which deletes it and cascades to its transactions.

## 7. Reading the data (code changes)

- `lib/budget.ts`: add `fetchCardTotals(from, to)`, which selects from `transactions` where `excluded = false` and the line item is set, then sums by `(line_item_id, month)` on the client. A SQL view with `GROUP BY` also works, but the volume is small. Give `MonthlyAmount` a `card` field. `indexAmounts` uses `manual + card`, so `summarizeMonth`, the Dashboard, and the Year grid pick it up with no further changes.
- **Month page**: under each input, add a muted "+ $X Amex · N" link that opens a dialog listing the transactions, where line items can be re-assigned. Show an "N uncategorized Amex charges ($Y)" banner when there are any.
- **"Entered" semantics:** a cell with only card spending counts as entered.
- Suggestions and anomaly hints (`suggestedAmount`, `anomalyHint`) should treat manual and card amounts as one total.

## 8. Build order

1. Migration (`imports`, `transactions`, `merchant_rules` + RLS).
2. `lib/amex.ts`: parser, merchant normalizer, and categorizer. These are pure functions, so they're easy to test against the sample file.
3. `/import/card` page: upload → check → review → import.
4. Merge card totals into reads, and add the Month page "+ from Amex" detail.
5. Import history with undo.

That's about a day of work for 1–3 and half a day for 4–5.

## 9. Later

- **Truly hands-off:** Plaid or a similar aggregator could pull transactions daily. That needs a server-side token store (a Supabase Edge Function) and a paid account, so it's better done after the manual import has proven the categories.
- A Chase or bank CSV parser that plugs into the same pipeline.
- A per-person spending split using `card_member`.
