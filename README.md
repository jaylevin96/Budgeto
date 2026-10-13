# Budgeto

Household budget tracker that replaces the yearly budget spreadsheet: quick monthly entry, plus month, year-to-date and year-over-year views of income, spending and savings.

Same stack as Tracko: Vite + React 19 + TypeScript, Tailwind v4 + shadcn/ui, Supabase, deployed on Vercel. Charts use Recharts.

## How it works

- **Categories** (Income, Home, Daily Living, …) have a type: income, spending or savings. 401k and HSA go under a savings category ("Financial Obligations"), so they're tracked, but not counted as spending.
- **Line items** (Rent, Comed, Jay Wage, …) are the rows. Each one is *fixed* (same amount monthly), *monthly, amount varies* (utilities) or *occasional*.
- **Monthly amounts**: one total per line item per month, just like a spreadsheet cell. An empty cell means "not entered yet"; `0` means "nothing this month".
- **Entries** ("Hotel $500", "Snorkel tour $120") are itemized amounts you add by hand, each with a name and a month. Tie one to a line item and it adds to that item's month; tie it to just a category and it shows in that category's "Entries" row; leave it untied and it counts as uncategorized spending. (Stored in the `one_offs` table; they were called one-offs before.)
- **Amex charges**, imported monthly from the statement download, add on top of what's typed. Each charge counts once: filed under a line item (adds to that cell), unfiled (counts as uncategorized spending until filed), linked to an entry you already added by hand (the entry counts instead), or "don't count" (card payments). Merchant choices are remembered, so later months mostly file themselves. See [`docs/AMEX_IMPORT.md`](docs/AMEX_IMPORT.md).
- **Budgets** (optional): a monthly target on any category or line item, shown as budget vs actual.
- **Notes**: any entered cell can carry a note (e.g. "AC ran all month").
- **Left over** = income − spending − savings, calculated per month (entries and card charges included).

### Pages

| Page | What it's for |
|---|---|
| **Dashboard** `/` | Month and year-to-date totals with changes, income vs spending by month, spending by category, where the money went, budget vs actual, largest entries, biggest changes vs last month |
| **Month** `/month/2026-10` | Data entry. **Fill recurring** enters every fixed and recent monthly amount in one click. Type the rest; Enter jumps to the next field and each value saves on its own. Warns when an amount is far from that item's usual. Add entries to any category, add notes, and see budget bars per category. |
| **Year** `/year/2026` | The spreadsheet view. Categories collapse to their totals and expand into editable line items (Enter moves down, Tab moves right). Cells marked `+1` include entries or card charges; click to see them. Shows year total, average, budget and a trend sparkline. **Export .xlsx** downloads the year in the spreadsheet's layout. |
| **Entries** `/entries` | Every entry in a year, grouped by month |
| **Settings** `/settings` | Add, rename, reorder or archive categories and line items; set recurring amounts |
| **Import** `/settings/import` | One-time import of the `.xlsx` budget, with a preview of totals before saving |
| **Import Amex** `/import/card` | Monthly: upload the Amex Excel/CSV download, review where each charge goes, import. Lists past imports with **Undo**. |

## Setup

### 1. Database (shared Supabase project)

The Supabase project is shared with Tracko and Resybot, so every Budgeto object lives in its own `budgeto` schema and nothing goes into `public`.

1. In the Supabase dashboard, open the **SQL Editor** and run each file in [`supabase/migrations/`](supabase/migrations/) in order, oldest first:
   - `20261013000000_budgeto_schema.sql` (categories, line items, monthly amounts)
   - `20261020000000_one_offs_budgets.sql` (one-off purchases and monthly budgets)
   - `20261021000000_card_import.sql` (Amex import: imports, transactions, merchant rules)
2. Go to **Project Settings → Data API → Exposed schemas** and add `budgeto`. Without this step, API calls fail with "schema must be one of the following".

Run migrations from the SQL editor rather than `supabase db push`. The project's migration history also contains Tracko's migrations, which this repo doesn't have.

### 2. Login

Auth (`auth.users`) is shared across all three apps, so the shared household login can be an account that already exists. You can also create one with **Need an account? Sign up** on the login screen (Supabase emails a confirmation link), or under **Authentication → Users → Add user** in the Supabase dashboard. Data is scoped per account with row-level security, so other accounts never see your budget.

### 3. Run locally

```bash
cp .env.example .env.local   # same URL + anon key as Tracko
npm install
npm run dev
```

### 4. Deploy (Vercel)

Import the repo in Vercel (framework preset: Vite) and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. `vercel.json` already rewrites all routes to `index.html`. Add the Vercel URL under **Authentication → URL Configuration → Redirect URLs** so password-reset emails work.

### 5. Bring in the spreadsheet

Sign in, go to **Settings → Import**, choose `2026_Budget.xlsx`, check the preview and click **Import**. Re-importing is safe: items are matched by name and amounts are overwritten.

### 6. Each month: import the Amex statement

On americanexpress.com open **Statements & Activity**, choose the statement and **Download → Excel**. In Budgeto, go to **Month → Import Amex** (or **Settings → Import Amex**) and choose the file.

1. The statement's totals are checked against its summary sheet, and charges already imported are skipped. Uploading a statement twice is harmless.
2. Each charge gets a destination: your remembered choice for that merchant, a built-in suggestion, or **Uncategorized**. Built-in suggestions only apply when a line item by that name exists (case, spaces and "and"/"&" don't matter):
   - Dining out (restaurants, coffee shops), Groceries, Accommodations, Plane fare, Rental car, Gas/fuel, Clothing, Books, Movies/plays, Cable TV, Netflix, Hulu, Gifts (Zola)
   - **Rideshare / Taxis** (Transportation: Uber, Lyft, shuttles), **Home furnishings** (Home: Crate & Barrel, HomeGoods, IKEA…), **Online shopping** (Daily Living: Amazon, online purchases), **Pharmacy** (Health: Walgreens, CVS), **Fees & government** (Misc Payments), **Shipping** (Misc Payments: UPS, FedEx, USPS), **Fitness** (Personal: sporting goods, Fleet Feet)

   To add the ones in bold in one go, run [`supabase/scripts/add_amex_line_items.sql`](supabase/scripts/add_amex_line_items.sql) in the SQL Editor (after the migrations). It skips any you already have, under any of the accepted names, and is safe to run again. Or add them under **Settings**. Card payments are left out automatically, and "Amex Split" credits from friends reduce the meal they paid back.
3. If you already added a purchase as an entry, the matching charge(s) are linked to it so it isn't counted twice. (Entries are only ever added by hand; the import doesn't create them.)
4. A warning appears when a charge lands on a line that already has a typed amount that month (e.g. Netflix typed by hand *and* on the card). Choose **Don't count** or clear the typed amount.
5. If nothing fits, pick **+ New category…** or **+ New line item…** (right under "Uncategorized" in the dropdown) to create it on the spot. A new category needs no separate line item name; it gets one with the same name. This works on the review screen and wherever you refile charges later.
6. Click **Import**. Anything left uncategorized still counts as spending, under **Uncategorized** (it isn't put into an "Other" line), and shows as a "Review" banner on that Month page until you file it.
