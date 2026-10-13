# Budgeto

Household budget tracker that replaces the yearly budget spreadsheet: quick monthly entry, plus month, year-to-date and year-over-year views of income, spending and savings.

Same stack as Tracko: Vite + React 19 + TypeScript, Tailwind v4 + shadcn/ui, Supabase, deployed on Vercel. Charts use Recharts.

## How it works

- **Categories** (Income, Home, Daily Living, …) have a type: income, spending or savings. 401k and HSA go under a savings category ("Financial Obligations"), so they're tracked, but not counted as spending.
- **Line items** (Rent, Comed, Jay Wage, …) are the rows. Each one is *fixed* (same amount monthly), *monthly, amount varies* (utilities) or *occasional*.
- **Monthly amounts**: one total per line item per month, just like a spreadsheet cell. An empty cell means "not entered yet"; `0` means "nothing this month".
- **One-off purchases** ("Miami flights $400", "New PlayStation $500") are named entries with a month and amount. Tie one to a line item and it adds to that item's month; tie it to just a category and it shows as that category's "One-offs" row; leave it untied and it counts as uncategorized spending.
- **Budgets** (optional): a monthly target on any category or line item, shown as budget vs actual.
- **Notes**: any entered cell can carry a note (e.g. "AC ran all month").
- **Left over** = income − spending − savings, calculated per month (one-offs included).

### Pages

| Page | What it's for |
|---|---|
| **Dashboard** `/` | Month and year-to-date totals with changes, income vs spending by month, spending by category, where the money went, budget vs actual, big purchases, biggest changes vs last month |
| **Month** `/month/2026-10` | Data entry. **Fill recurring** enters every fixed and recent monthly amount in one click. Type the rest; Enter jumps to the next field and each value saves on its own. Warns when an amount is far from that item's usual. Add one-offs and notes, and see budget bars per category. |
| **Year** `/year/2026` | The spreadsheet view. Categories collapse to their totals and expand into editable line items (Enter moves down, Tab moves right). Cells marked `+1` include one-offs; click to see them. Shows year total, average, budget and a trend sparkline. **Export .xlsx** downloads the year in the spreadsheet's layout. |
| **One-offs** `/one-offs` | Every one-off purchase in a year, grouped by month |
| **Settings** `/settings` | Add, rename, reorder or archive categories and line items; set recurring amounts |
| **Import** `/settings/import` | One-time import of the `.xlsx` budget, with a preview of totals before saving |

## Setup

### 1. Database (shared Supabase project)

The Supabase project is shared with Tracko and Resybot, so every Budgeto object lives in its own `budgeto` schema and nothing goes into `public`.

1. In the Supabase dashboard, open the **SQL Editor** and run each file in [`supabase/migrations/`](supabase/migrations/) in order, oldest first:
   - `20261013000000_budgeto_schema.sql` (categories, line items, monthly amounts)
   - `20261020000000_one_offs_budgets.sql` (one-off purchases and monthly budgets)
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
