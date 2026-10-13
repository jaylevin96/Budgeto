import { supabase } from "@/lib/supabase";
import { addMonths, currentMonthKey, type OneOff } from "@/lib/budget";

/**
 * A recurring manual entry (rent, wages, subscriptions): a template that gives every month
 * from `start_month` through `end_month` (or the current month when open-ended) a real
 * manual entry linked by `one_offs.recurring_id`, except months in `skip_months`. Months are
 * created when the app loads, never ahead of the current month.
 */
export type RecurringEntry = {
  id: string;
  name: string;
  amount: number;
  category_id: string;
  line_item_id: string | null;
  note: string | null;
  /** First month, YYYY-MM-01 */
  start_month: string;
  /** Last month (inclusive); null = keeps going */
  end_month: string | null;
  skip_months: string[];
};

/** What an entry says: shared by a recurring entry and each of its months */
export type EntryFields = Pick<RecurringEntry, "name" | "amount" | "category_id" | "line_item_id" | "note">;

/** Which months an edit or delete applies to, counted from the month being edited */
export type Scope = "this" | "future" | "all";

const COLUMNS = "id, name, amount, category_id, line_item_id, note, start_month, end_month, skip_months";

const toEntry = (r: RecurringEntry): RecurringEntry => ({ ...r, amount: Number(r.amount), skip_months: r.skip_months ?? [] });
const clean = (f: EntryFields): EntryFields => ({ ...f, name: f.name.trim(), note: f.note?.trim() || null });

export async function fetchRecurring(): Promise<RecurringEntry[]> {
  const { data, error } = await supabase.from("recurring_entries").select(COLUMNS).order("start_month").order("name");
  if (error) throw error;
  return (data as RecurringEntry[]).map(toEntry);
}

/** Whether a recurring entry covers `month` (in range and not skipped) */
export function activeIn(r: RecurringEntry, month: string): boolean {
  return r.start_month <= month && (r.end_month === null || month <= r.end_month) && !r.skip_months.includes(month);
}

/** Months up to `through` that should have an occurrence but don't yet */
export function dueMonths(r: RecurringEntry, existing: Set<string>, through: string): string[] {
  const last = r.end_month !== null && r.end_month < through ? r.end_month : through;
  const out: string[] = [];
  for (let m = r.start_month; m <= last; m = addMonths(m, 1)) {
    if (!existing.has(m) && !r.skip_months.includes(m)) out.push(m);
  }
  return out;
}

/** Create any missing months (through `through`) for every recurring entry. Returns how many were added. */
export async function ensureOccurrences(entries: RecurringEntry[], through = currentMonthKey()): Promise<number> {
  if (!entries.length) return 0;
  const { data, error } = await supabase.from("one_offs").select("recurring_id, month").not("recurring_id", "is", null).range(0, 9999);
  if (error) throw error;
  const have = new Map<string, Set<string>>();
  for (const row of data as { recurring_id: string; month: string }[]) {
    let s = have.get(row.recurring_id);
    if (!s) have.set(row.recurring_id, (s = new Set()));
    s.add(row.month);
  }
  const rows = entries.flatMap((r) =>
    dueMonths(r, have.get(r.id) ?? new Set(), through).map((month) => ({ ...fieldsOf(r), month, recurring_id: r.id }))
  );
  for (let i = 0; i < rows.length; i += 500) {
    const { error: err } = await supabase
      .from("one_offs")
      .upsert(rows.slice(i, i + 500), { onConflict: "recurring_id,month", ignoreDuplicates: true });
    if (err) throw err;
  }
  return rows.length;
}

export function fieldsOf(x: EntryFields): EntryFields {
  return { name: x.name, amount: x.amount, category_id: x.category_id, line_item_id: x.line_item_id, note: x.note };
}

/** Start a recurring entry; its first month (if not in the future) is created right away. */
export async function createRecurring(fields: EntryFields, startMonth: string): Promise<RecurringEntry> {
  const { data, error } = await supabase
    .from("recurring_entries")
    .insert({ ...clean(fields), start_month: startMonth })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  const entry = toEntry(data as RecurringEntry);
  await ensureOccurrences([entry]);
  return entry;
}

/** Turn an existing manual entry into the first month (`month`) of a new recurring entry. */
export async function makeRecurring(oneOff: OneOff, fields: EntryFields, month: string): Promise<RecurringEntry> {
  const { data, error } = await supabase
    .from("recurring_entries")
    .insert({ ...clean(fields), start_month: month })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  const entry = toEntry(data as RecurringEntry);
  const { error: err } = await supabase
    .from("one_offs")
    .update({ ...clean(fields), month, recurring_id: entry.id })
    .eq("id", oneOff.id);
  if (err) throw err;
  await ensureOccurrences([entry]);
  return entry;
}

/**
 * Change a recurring entry as of `month`: "this" changes only that month's entry,
 * "future" changes the template and that month onwards, "all" changes every month.
 */
export async function updateRecurring(
  entry: RecurringEntry,
  fields: EntryFields,
  scope: Scope,
  month: string,
  occurrenceId?: string
): Promise<void> {
  const row = clean(fields);
  if (scope === "this") {
    if (!occurrenceId) throw new Error("No entry for that month");
    const { error } = await supabase.from("one_offs").update(row).eq("id", occurrenceId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("recurring_entries").update(row).eq("id", entry.id);
  if (error) throw error;
  let q = supabase.from("one_offs").update(row).eq("recurring_id", entry.id);
  if (scope === "future" && month > entry.start_month) q = q.gte("month", month);
  const { error: err } = await q;
  if (err) throw err;
}

/**
 * Remove a recurring entry as of `month`: "this" skips that month, "future" stops it from that
 * month on (past months stay), "all" deletes it and every month it created.
 */
export async function removeRecurring(entry: RecurringEntry, scope: Scope, month: string): Promise<void> {
  if (scope === "this") {
    const { error } = await supabase
      .from("recurring_entries")
      .update({ skip_months: [...new Set([...entry.skip_months, month])].sort() })
      .eq("id", entry.id);
    if (error) throw error;
    const { error: err } = await supabase.from("one_offs").delete().eq("recurring_id", entry.id).eq("month", month);
    if (err) throw err;
    return;
  }
  if (scope === "future") return stopRecurring(entry, addMonths(month, -1));
  const { error } = await supabase.from("recurring_entries").delete().eq("id", entry.id);
  if (error) throw error;
}

/** End a recurring entry after `lastMonth`; later months are deleted. Before it started, it's deleted entirely. */
export async function stopRecurring(entry: RecurringEntry, lastMonth: string): Promise<void> {
  if (lastMonth < entry.start_month) return removeRecurring(entry, "all", entry.start_month);
  const { error } = await supabase.from("recurring_entries").update({ end_month: lastMonth }).eq("id", entry.id);
  if (error) throw error;
  const { error: err } = await supabase.from("one_offs").delete().eq("recurring_id", entry.id).gt("month", lastMonth);
  if (err) throw err;
}

/** Bring back a stopped recurring entry from `fromMonth` (a new one, so the gap stays empty). */
export function restartRecurring(entry: RecurringEntry, fromMonth: string): Promise<RecurringEntry> {
  return createRecurring(fieldsOf(entry), fromMonth);
}

/** Undo "skip this month": the month is filled in again. */
export async function unskipRecurring(entry: RecurringEntry, month: string): Promise<void> {
  const next = { ...entry, skip_months: entry.skip_months.filter((m) => m !== month) };
  const { error } = await supabase.from("recurring_entries").update({ skip_months: next.skip_months }).eq("id", entry.id);
  if (error) throw error;
  await ensureOccurrences([next]);
}
