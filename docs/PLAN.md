# Budgeto — Plan

A household budget tracker that replaces `2026_Budget.xlsx`: quick, accurate data entry plus month, year-to-date and year-over-year views of income and spending.

---

## 1. What the spreadsheet does today

One sheet, one year, a grid of **line items × months**:

| Section (spreadsheet table) | Line items |
|---|---|
| Income (`tblIncome`) | Jay Wage, Jillian Wage |
| Home (`tblHome`) | Rent, Insurance, Comed, Gas |
| Daily Living (`tblDaily`) | Groceries, Child care, Dry cleaning, Dining out, Housecleaning |
| Transportation | Gas/fuel, Car Insurance |
| Entertainment | Cable TV, Movies/plays, Concerts/clubs |
| Health | FFC, Health Insurance |
| Vacations | Plane fare, Accommodations, Food, Rental car |
| Subscriptions (`tblDues`) | Netflix, Hulu |
| Personal | Clothing, Gifts, Salon/barber, Books, Music |
| Financial Obligations | Jay 401k, Jay Health Savings |
| Misc Payments | Other ×5 |
| Totals | Total income, Total expenses, Net income, sparklines |

What the app needs to fix or keep:

- **Most rows don't change month to month.** Rent, wages, 401k, HSA, health insurance, FFC and gas/fuel repeat. Utilities (Comed, Gas) recur with a different amount each month. Only a few rows are truly ad hoc. The app should fill in the recurring rows for you, so you only confirm them or edit the amount.
- **Bug in the spreadsheet:** the Net Income row is wrong for every other month. `D78 = C76-C77`, so February shows January's net. The same happens in Apr, Jun, Aug, Oct and Dec. The app calculates totals itself, so this can't happen there.
- **Savings are counted as expenses.** 401k and HSA count toward "Total expenses". The app will tag them as **savings** so you can see spending and saving separately. "Net" can then include or leave out savings.
- **One year per file.** The app keeps every year in one database, so year-over-year comparisons come for free.
- **"Other" ×5** placeholder rows go away. You can add a line item in one tap instead.

---

## 2. Stack (mirrors Tracko)

| Layer | Choice | Notes |
|---|---|---|
| Build | Vite 6 + React 19 + TypeScript | Same `tsconfig*`, `@/` alias, eslint config |
| UI | Tailwind v4 + shadcn/ui (new-york, neutral) + lucide-react | Copy Tracko's `components/ui/*`, `index.css` theme tokens, `useTheme` (dark mode) |
| Routing | react-router-dom v7 | Same `ProtectedRoute` / `PublicRoute` pattern |
| Backend | Supabase (Postgres + Auth + RLS) | Shared hobby project, isolated schema (§3) |
| Charts | **Recharts** (new; Tracko has no charts) | Small, React-native, good enough for bars/lines/donut |
| Import | `xlsx` (already used in Tracko) | One-time import of the 2026 spreadsheet |
| Hosting | Vercel (static SPA, `vercel.json` rewrite) | **No Railway needed.** No server process; everything is client → Supabase with RLS |

Env stays the same as Tracko: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

---

## 3. Sharing the Supabase project (the "prefix")

Tracko puts its tables straight into `public` (`contacts`, `gifts_sent`, … and a `public.set_updated_at()` function). Resybot is in the same project. To keep Budgeto from colliding with either, there are two options:

**Option A (recommended): a dedicated Postgres schema `budgeto`**

All tables live at `budgeto.categories`, `budgeto.transactions` and so on. Nothing can collide with `public`, and the whole app can be dropped later with one `DROP SCHEMA budgeto CASCADE`.

```sql
create schema if not exists budgeto;
grant usage on schema budgeto to anon, authenticated, service_role;
alter default privileges in schema budgeto
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema budgeto
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema budgeto
  grant execute on functions to anon, authenticated, service_role;
```

One manual step: in the Supabase dashboard, open **Project Settings → Data API → Exposed schemas** and add `budgeto`. The client then targets it:

```ts
export const supabase = createClient(url, anonKey, { db: { schema: "budgeto" } });
```

**Option B: a table-name prefix in `public`** (`budgeto_categories`, `budgeto_transactions`, …). There's no dashboard step, but names get noisier and you could still collide on shared function names.

Things to know with either option:

- **Auth is shared.** `auth.users` is one table for all three apps, so a Budgeto login is the same account as your Tracko login. That's convenient, and RLS keeps the data separate. Consider turning off open sign-ups, or adding an allowlist, so strangers can't create accounts.
- **Migrations.** Keep SQL in `supabase/migrations/` like Tracko does, prefix every object with the schema, and define Budgeto's own `budgeto.set_updated_at()` instead of reusing Tracko's. Because the project is shared, `supabase db push` from this repo will complain about Tracko's migrations, which it doesn't know about. Either apply migrations through the SQL editor, or run `db push --include-all` with care.

---

## 4. Data model

The spreadsheet's grid becomes three core tables plus a household. A **household** lets Jay and Jillian both log in and see the same budget.

```
households            id, name
household_members     household_id, user_id, display_name ("Jay", "Jillian"), role
categories            id, household_id, name ("Home"), kind: income|expense|savings,
                      sort_order, color, archived
line_items            id, household_id, category_id, name ("Rent"),
                      owner_member_id (nullable; e.g. "Jay Wage", "Jay 401k"),
                      is_recurring bool, default_amount numeric(12,2) null,
                      cadence: monthly|annual|semiannual|null, due_day int null,
                      monthly_budget numeric(12,2) null,   -- phase 2 targets
                      sort_order, archived
transactions          id, household_id, line_item_id, amount numeric(12,2) > 0,
                      occurred_on date, period_month date (first of month, generated),
                      note text, source: manual|recurring|import,
                      created_by uuid, created_at, updated_at
```

Design notes:

- **Amounts are always positive.** The sign comes from the category's `kind`, so nobody types a minus sign in the wrong place. Money is stored as `numeric(12,2)`, never floats.
- **`period_month`** is derived from `occurred_on` (a generated column). It keeps monthly rollups simple and indexable.
- **Many rows per item per month are allowed** (e.g. several grocery trips). The grid cell shows the sum, and clicking it opens the individual entries.
- **Insurance-style items** (Car Insurance: Feb and Aug, $841) use `cadence = semiannual`, so they only show up as due in the months they apply.
- **RLS:** every table checks `household_id in (select household_id from budgeto.household_members where user_id = auth.uid())`. This is the same pattern as Tracko's `user_id = auth.uid()`, one level up.
- **Views** for the dashboard (these keep the math in Postgres instead of scattered across React):
  - `v_monthly_item_totals` (household, line item, month, total)
  - `v_monthly_summary` (household, month, income, expenses, savings, net, savings rate)

---

## 5. Data entry (fast and accurate)

Three entry paths for three kinds of data:

### 5.1 Month Close (the replacement for the spreadsheet grid)
`/month/2026-10`: a page per month listing every line item, grouped by category in the same order as the spreadsheet.

- Recurring items are **pre-filled with their default amount** and show as "pending" until you tap ✓ to confirm. One tap confirms all the fixed items (rent, wages, 401k, HSA, FFC, health insurance).
- Variable recurring items (Comed, Gas) are pre-filled with **last month's amount** and focus the input, so you type the bill amount and press Enter to move to the next one.
- A progress bar ("18 / 22 items entered") and a "not entered yet" filter make it obvious what's missing, so a month never closes with a blank Comed bill.
- Keyboard-first: Tab/Enter walks down the list, much like the spreadsheet.

### 5.2 Quick Add (on the go, phone)
A floating **+** button on every page opens a sheet with:
amount (numeric keypad, autofocus) → line item (searchable, recent and frequent items first) → date (defaults to today) → optional note → Save.
**Save & add another** keeps the sheet open. Three taps for a coffee or a grocery run.

### 5.3 Transactions list
`/transactions`: a filterable table by month, category, item, person and text search, with inline edit and delete. This is where mistakes get fixed. A bank CSV import can live here later (phase 3).

### Accuracy guards
- Amount is required and must be > 0 with at most 2 decimals; this is enforced in both the UI and a DB `CHECK`.
- An **anomaly hint** appears when an amount is more than 2× or less than 0.5× that item's trailing 3-month average ("Comed is usually ~$110, you entered $1,100").
- A **duplicate warning** appears for the same item, same amount and same date.
- The Month Close page shows the month's totals live, so you can sanity-check against your bank before you close it.

---

## 6. Dashboards and visualization

`/` Dashboard, with a month picker and a year picker:

1. **KPI tiles** for the selected month, each with a delta vs last month and a YTD figure: Income · Expenses · Savings · Net · Savings rate.
2. **Income vs Expenses by month**: grouped bars for the year, with a net line overlaid. This replaces the TOTALS block.
3. **Spending by category over time**: stacked bars by month, one color per category.
4. **Category breakdown**: a horizontal bar chart for the selected month or year, ranked. It's easier to read than a pie.
5. **Month-over-month table**: the spreadsheet grid, read-only, with a YEAR column, a sparkline per row (replacing the SPARKLINE column) and conditional color for big changes. Rows expand by category.
6. **Line item drill-down** (`/items/:id`): a 12- to 24-month trend line, average, min/max and every transaction. Answers questions like "how has Comed trended?"
7. **Year view** (`/year/2026`): annual totals, average monthly spend, best and worst months, and this year vs last year once two years of data exist.

Phase 2 adds **budget vs actual**. With `monthly_budget` set on line items, each category shows a progress bar (green/amber/red) and the dashboard gets a "remaining this month" tile.

---

## 7. Pages and routes

```
/login, /reset-password          (copy from Tracko)
/                                Dashboard
/month/:yyyy-mm                  Month Close (entry grid)
/transactions                    Ledger list
/year/:yyyy                      Year view
/items/:id                       Line item drill-down
/settings                        Categories & line items (rename, reorder, recurring defaults, budgets)
/settings/household              Members / invite partner
/settings/import                 Import spreadsheet
```

Navigation: Dashboard · Month · Transactions · Settings, plus a global **+** button.

---

## 8. Spreadsheet import

`/settings/import` uses the `xlsx` lib in the browser, the same approach as Tracko's contacts import:

1. Read the `PERSONAL BUDGET` sheet. Walk the rows: a row whose C column says `JAN` is a section header (category), and rows until `Total` are line items.
2. Map the sections to a kind: `INCOME` → income, `FINANCIAL OBLIGATIONS` → savings, everything else → expense. Skip empty `Other` rows.
3. For every non-empty month cell, create a transaction with `occurred_on = 2026-MM-01`, `source = import`.
4. Mark an item recurring when it has the same amount in 3 or more consecutive months, and use that amount as `default_amount`. This seeds Month Close.
5. Show a **preview** of categories, items, transaction count and per-month totals before committing, so you can check them against the spreadsheet (and see the corrected Net Income).

---

## 9. Build phases

**Phase 1: MVP (usable for Oct 2026 onward)**
- Scaffold from Tracko (Vite, Tailwind, shadcn, auth pages, layout, theme)
- `budgeto` schema migration: tables, RLS, views, seed default categories
- Household bootstrap on first login (create household and membership)
- Settings: categories and line items CRUD with recurring defaults
- Month Close page and Quick Add
- Spreadsheet import (gets Jan–Sep 2026 in)
- Dashboard: KPI tiles, income vs expenses chart, category breakdown
- Deploy to Vercel

**Phase 2: insight**
- Transactions list with filters and edit
- Stacked category chart, month-over-month grid with sparklines, item drill-down, year view
- Budgets / targets and budget-vs-actual
- Anomaly and duplicate hints
- Invite Jillian to the household

**Phase 3: nice to have**
- Bank / credit card CSV import with merchant → line item rules
- Export a year back to .xlsx
- PWA install (home-screen icon) for phone Quick Add
- Recurring reminders (e.g. "Comed bill not entered for October")

---

## 10. Open questions

1. **Granularity:** do you want individual transactions (each grocery trip), or one number per item per month like the spreadsheet? The model supports both; this decides whether Quick Add or Month Close is the main screen.
2. **Jillian:** will she log in and enter data too (household model), or is this single-user?
3. **Schema vs prefix:** are you OK adding `budgeto` to Exposed schemas in the Supabase dashboard (Option A), or do you prefer `budgeto_` table names in `public` (Option B)?
4. **Savings in "Net":** should 401k and HSA count against net income (as the spreadsheet does), or be shown separately?
