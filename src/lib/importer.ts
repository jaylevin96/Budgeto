import { supabase } from "@/lib/supabase";
import {
  fetchStructure,
  DEFAULT_STRUCTURE,
  fetchOneOffs,
  insertOneOffs,
  monthKey,
  type CategoryKind,
  type OneOffInput,
  type Recurrence,
} from "@/lib/budget";

export type ParsedItem = {
  name: string;
  /** 12 entries Jan..Dec; null = empty cell */
  values: (number | null)[];
  recurrence: Recurrence;
  default_amount: number | null;
};

export type ParsedSection = {
  name: string;
  kind: CategoryKind;
  items: ParsedItem[];
};

export type ParsedBudget = {
  year: number | null;
  sections: ParsedSection[];
};

function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s; // already mixed case, e.g. "Subscriptions"
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function kindForSection(name: string): CategoryKind {
  const n = name.toLowerCase();
  if (n === "income" || n === "revenue") return "income";
  if (n.includes("financial") || n.includes("saving") || n.includes("401k") || n.includes("retire")) return "savings";
  return "expense";
}

/** Guess recurrence from a year of values. */
export function inferRecurrence(values: (number | null)[]): { recurrence: Recurrence; default_amount: number | null } {
  const filled = values.filter((v): v is number => v !== null && v > 0);
  if (filled.length < 3) return { recurrence: "none", default_amount: null };
  // Longest trailing run of the same amount (e.g. a raise mid-year still reads as fixed once it has held 3 months)
  const last = filled[filled.length - 1];
  let run = 0;
  for (let i = filled.length - 1; i >= 0 && filled[i] === last; i--) run++;
  if (run >= 3) return { recurrence: "fixed", default_amount: last };
  // Present in most months but changing → utility-like
  const firstIdx = values.findIndex((v) => v !== null && v > 0);
  const lastIdx = values.length - 1 - [...values].reverse().findIndex((v) => v !== null && v > 0);
  const span = lastIdx - firstIdx + 1;
  if (filled.length >= span * 0.75) return { recurrence: "variable", default_amount: null };
  return { recurrence: "none", default_amount: null };
}

/**
 * Parse the "Monthly Budget" spreadsheet layout: a header row per section whose
 * cells read SECTION | JAN | FEB | … | DEC, followed by item rows, ending at "Total".
 */
export async function parseBudgetWorkbook(data: ArrayBuffer): Promise<ParsedBudget> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: true, raw: true }) as unknown[][];

  let year: number | null = null;
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  let nameCol = -1;

  for (const row of rows) {
    const cells = row.map((c) => (typeof c === "string" ? c.trim() : c));

    if (year === null) {
      for (const c of cells) {
        const m = typeof c === "string" ? c.match(/\b(20\d{2})\b/) : null;
        if (m) year = Number(m[1]);
      }
    }

    const janCol = cells.findIndex((c) => typeof c === "string" && c.toUpperCase() === "JAN");
    if (janCol > 0) {
      const label = String(cells[janCol - 1] ?? "").trim();
      if (!label || label.toUpperCase() === "TOTALS") {
        current = null; // summary block: computed by the app
        continue;
      }
      nameCol = janCol - 1;
      current = { name: titleCase(label), kind: kindForSection(label), items: [] };
      sections.push(current);
      continue;
    }

    if (!current) continue;
    const name = typeof cells[nameCol] === "string" ? (cells[nameCol] as string) : "";
    if (!name) {
      current = null;
      continue;
    }
    if (name.toLowerCase() === "total") {
      current = null;
      continue;
    }
    const values: (number | null)[] = [];
    for (let m = 0; m < 12; m++) {
      const v = cells[nameCol + 1 + m];
      values.push(typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
    }
    // Skip unused placeholder rows ("Other" with no values)
    if (name.toLowerCase() === "other" && values.every((v) => v === null)) continue;
    current.items.push({ name, values, ...inferRecurrence(values) });
  }

  return { year, sections };
}

export type ImportResult = { categoriesCreated: number; itemsCreated: number; entriesSaved: number };

/**
 * Create any missing categories and line items (matched case-insensitively by name),
 * then upsert every non-empty month cell for `year`. Existing items keep their settings.
 */
export async function applyBudget(
  sections: ParsedSection[],
  year: number | null
): Promise<ImportResult> {
  let { categories, items } = await fetchStructure();
  const result: ImportResult = { categoriesCreated: 0, itemsCreated: 0, entriesSaved: 0 };
  const key = (s: string) => s.trim().toLowerCase();

  const catByName = new Map(categories.map((c) => [key(c.name), c]));
  const newCats = sections
    .filter((s) => !catByName.has(key(s.name)))
    .map((s) => ({ name: s.name, kind: s.kind, sort_order: (sections.indexOf(s) + 1) * 10 }));
  if (newCats.length) {
    const { error } = await supabase.from("categories").insert(newCats);
    if (error) throw error;
    result.categoriesCreated = newCats.length;
  }

  ({ categories, items } = await fetchStructure());
  const catId = new Map(categories.map((c) => [key(c.name), c.id]));
  const itemKey = (categoryId: string, name: string) => `${categoryId}|${key(name)}`;
  const existingItems = new Set(items.map((i) => itemKey(i.category_id, i.name)));

  const newItems: Record<string, unknown>[] = [];
  for (const s of sections) {
    const cid = catId.get(key(s.name))!;
    s.items.forEach((it, i) => {
      if (existingItems.has(itemKey(cid, it.name))) return;
      existingItems.add(itemKey(cid, it.name));
      newItems.push({
        category_id: cid,
        name: it.name,
        recurrence: it.recurrence,
        default_amount: it.default_amount,
        sort_order: (i + 1) * 10,
      });
    });
  }
  if (newItems.length) {
    const { error } = await supabase.from("line_items").insert(newItems);
    if (error) throw error;
    result.itemsCreated = newItems.length;
  }

  if (year !== null) {
    ({ categories, items } = await fetchStructure());
    const itemByKey = new Map(items.map((i) => [itemKey(i.category_id, i.name), i]));
    // Each filled cell becomes a manual entry named after its line item. A typed 0 only meant
    // "nothing this month", so it's skipped.
    const rows: OneOffInput[] = [];
    for (const s of sections) {
      const cid = catId.get(key(s.name))!;
      for (const it of s.items) {
        const item = itemByKey.get(itemKey(cid, it.name));
        if (!item) continue;
        it.values.forEach((v, m) => {
          if (v !== null && v > 0)
            rows.push({
              name: item.name,
              amount: v,
              month: monthKey(year, m),
              category_id: cid,
              line_item_id: item.id,
              note: null,
              repeats: it.recurrence !== "none",
            });
        });
      }
    }
    // Re-importing replaces the entries an earlier import made for those cells (same line, month and name)
    const cell = (o: { line_item_id: string | null; month: string; name: string }) => `${o.line_item_id}|${o.month}|${key(o.name)}`;
    const cells = new Set(rows.map(cell));
    const stale = (await fetchOneOffs(monthKey(year, 0), monthKey(year + 1, 0))).filter((o) => cells.has(cell(o)));
    for (let i = 0; i < stale.length; i += 200) {
      const { error } = await supabase.from("one_offs").delete().in("id", stale.slice(i, i + 200).map((o) => o.id));
      if (error) throw error;
    }
    result.entriesSaved = (await insertOneOffs(rows)).length;
  }

  return result;
}

/** Create the spreadsheet's default categories and line items (no amounts). */
export async function seedDefaults(): Promise<ImportResult> {
  return applyBudget(
    DEFAULT_STRUCTURE.map((s) => ({
      name: s.name,
      kind: s.kind,
      items: s.items.map((name) => ({ name, values: Array(12).fill(null), recurrence: "none" as const, default_amount: null })),
    })),
    null
  );
}
