import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local.");
}

// Budgeto shares a Supabase project with Tracko and Resybot; all of its tables
// live in the dedicated `budgeto` schema (must be listed under Data API → Exposed schemas).
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: "budgeto" },
});
