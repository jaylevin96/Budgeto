-- Budgeto initial schema.
-- This Supabase project is shared with Tracko and Resybot, so everything lives in the
-- dedicated `budgeto` schema (never `public`). After running this, add `budgeto` to
-- Project Settings → Data API → Exposed schemas.
--
-- Model mirrors the 2026 budget spreadsheet: categories (sections) → line items (rows)
-- → one amount per line item per month (cells). All rows are scoped to auth.uid().

CREATE SCHEMA IF NOT EXISTS budgeto;

GRANT USAGE ON SCHEMA budgeto TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA budgeto GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA budgeto GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA budgeto GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- Sections of the budget: Income, Home, Daily Living, … Financial Obligations.
-- kind decides how amounts roll up: income adds, expense and savings subtract.
-- savings (401k, HSA) is tracked separately so it isn't counted as spending.
CREATE TABLE budgeto.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  kind text NOT NULL CHECK (kind IN ('income', 'expense', 'savings')),
  sort_order integer NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name),
  UNIQUE (id, user_id)
);

-- Rows within a section: Rent, Comed, Jay Wage, …
-- recurrence drives pre-fill on the Month page:
--   fixed    – same amount every month (default_amount), confirm with one tap
--   variable – recurs monthly but amount changes (utilities); pre-fills last month's amount
--   none     – occasional (vacations, gifts); no pre-fill
CREATE TABLE budgeto.line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  recurrence text NOT NULL DEFAULT 'none' CHECK (recurrence IN ('fixed', 'variable', 'none')),
  default_amount numeric(12, 2) CHECK (default_amount IS NULL OR default_amount >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, name),
  UNIQUE (id, user_id),
  -- composite FK: a line item can only belong to one of the same user's categories
  FOREIGN KEY (category_id, user_id) REFERENCES budgeto.categories(id, user_id) ON DELETE CASCADE
);

CREATE INDEX idx_line_items_category_id ON budgeto.line_items(category_id);

-- One amount per line item per month (a spreadsheet cell).
-- A missing row means "not entered yet"; 0 means "entered, nothing this month".
CREATE TABLE budgeto.monthly_amounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  line_item_id uuid NOT NULL,
  month date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (line_item_id, month),
  FOREIGN KEY (line_item_id, user_id) REFERENCES budgeto.line_items(id, user_id) ON DELETE CASCADE
);

CREATE INDEX idx_monthly_amounts_user_month ON budgeto.monthly_amounts(user_id, month);

-- updated_at trigger (own copy; Tracko's public.set_updated_at is not reused)
CREATE OR REPLACE FUNCTION budgeto.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER categories_updated_at BEFORE UPDATE ON budgeto.categories
  FOR EACH ROW EXECUTE FUNCTION budgeto.set_updated_at();
CREATE TRIGGER line_items_updated_at BEFORE UPDATE ON budgeto.line_items
  FOR EACH ROW EXECUTE FUNCTION budgeto.set_updated_at();
CREATE TRIGGER monthly_amounts_updated_at BEFORE UPDATE ON budgeto.monthly_amounts
  FOR EACH ROW EXECUTE FUNCTION budgeto.set_updated_at();

-- Grants for tables created above (default privileges only cover future objects
-- created by the same role, so grant explicitly too).
GRANT ALL ON ALL TABLES IN SCHEMA budgeto TO anon, authenticated, service_role;

-- Row Level Security: every row belongs to auth.uid()
ALTER TABLE budgeto.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgeto.line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgeto.monthly_amounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own categories" ON budgeto.categories
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own line items" ON budgeto.line_items
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own monthly amounts" ON budgeto.monthly_amounts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
