-- Add the line items that the Amex import's built-in suggestions file charges into.
-- One-time data script: run it in the Supabase SQL Editor after the migrations.
-- Safe to run more than once. It never changes or deletes anything. A line item is skipped
-- if you already have it, or any name the import accepts for it (e.g. "Uber/Lyft" for
-- Rideshare / Taxis), in any category. Names are compared the way the import compares them:
-- ignoring case, spaces and "and" vs "&". A category is created only if you don't have it.
--
-- Which account: the SQL Editor has no signed-in app user, so the script finds the budget's
-- owner itself. If only one account has a Budgeto budget, it's used automatically. If there
-- are several, put your login email in target_email below.

-- Temporary helper (gone when the session ends): "Rideshare / Taxis" = "rideshare/taxis",
-- "Fees and government" = "Fees & government"
CREATE OR REPLACE FUNCTION pg_temp.name_key(n text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT regexp_replace(regexp_replace(lower(n), '\mand\M', '&', 'g'), '\s+', '', 'g')
$f$;

DO $$
DECLARE
  target_email text := '';  -- e.g. 'you@example.com'; leave empty to auto-detect
  target_user uuid;
  owners int;
  want record;
  cat_id uuid;
  added text[] := '{}';
BEGIN
  IF target_email <> '' THEN
    SELECT id INTO target_user FROM auth.users WHERE lower(email) = lower(target_email);
    IF target_user IS NULL THEN
      RAISE EXCEPTION 'No account with email %', target_email;
    END IF;
  ELSE
    SELECT count(DISTINCT user_id) INTO owners FROM budgeto.categories;
    IF owners = 0 THEN
      RAISE EXCEPTION 'No Budgeto budget found yet. Sign in to the app and set up your budget first.';
    ELSIF owners > 1 THEN
      RAISE EXCEPTION '% accounts have a Budgeto budget. Set target_email at the top of this script.', owners;
    END IF;
    SELECT DISTINCT user_id INTO target_user FROM budgeto.categories;
  END IF;

  -- category, line item to add, other names the import accepts (keep in sync with src/lib/amex.ts)
  FOR want IN
    SELECT * FROM (VALUES
      ('Transportation', 'Rideshare / Taxis', ARRAY['Rideshare', 'Taxis', 'Uber/Lyft']),
      ('Home',           'Home furnishings',  ARRAY['Furnishings', 'Furniture', 'Home goods', 'Household']),
      ('Daily Living',   'Online shopping',   ARRAY['Amazon', 'Shopping']),
      ('Health',         'Pharmacy',          ARRAY['Pharmacies', 'Prescriptions']),
      ('Personal',       'Fitness',           ARRAY['Sporting goods']),
      ('Misc Payments',  'Fees & government', ARRAY['Fees', 'Government fees', 'Taxes & fees']),
      ('Misc Payments',  'Shipping',          ARRAY['Postage', 'Shipping & postage'])
    ) AS t(category, item, aliases)
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM budgeto.line_items
      WHERE user_id = target_user
        AND pg_temp.name_key(name) = ANY (
          SELECT pg_temp.name_key(n) FROM unnest(want.item || want.aliases) AS n
        )
    );

    SELECT id INTO cat_id FROM budgeto.categories
      WHERE user_id = target_user AND pg_temp.name_key(name) = pg_temp.name_key(want.category);
    IF cat_id IS NULL THEN
      INSERT INTO budgeto.categories (user_id, name, kind, sort_order)
      VALUES (
        target_user, want.category, 'expense',
        (SELECT coalesce(max(sort_order), 0) + 10 FROM budgeto.categories WHERE user_id = target_user)
      )
      RETURNING id INTO cat_id;
      added := added || ('category ' || want.category);
    END IF;

    INSERT INTO budgeto.line_items (user_id, category_id, name, recurrence, sort_order)
    VALUES (
      target_user, cat_id, want.item, 'none',
      (SELECT coalesce(max(sort_order), 0) + 10 FROM budgeto.line_items WHERE category_id = cat_id)
    );
    added := added || (want.category || ' › ' || want.item);
  END LOOP;

  IF cardinality(added) = 0 THEN
    RAISE NOTICE 'Nothing to add: every line item already exists.';
  ELSE
    RAISE NOTICE 'Added: %', array_to_string(added, ', ');
  END IF;
END $$;

DROP FUNCTION IF EXISTS pg_temp.name_key(text);
