import { useState } from "react";
import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  deleteOneOff,
  formatMoney,
  formatMonth,
  MONTH_LONG,
  monthKey,
  parseAmount,
  parseMonthKey,
  saveOneOff,
  type Category,
  type LineItem,
  type OneOff,
} from "@/lib/budget";
import {
  createRecurring,
  makeRecurring,
  removeRecurring,
  updateRecurring,
  type EntryFields,
  type RecurringEntry,
  type Scope,
} from "@/lib/recurring";
import { cn } from "@/lib/utils";

/**
 * Add or edit a manual entry (a one_offs row). `onSaved(id, null)` means it was deleted.
 * For one month of a recurring entry, saving and deleting ask which months to change, and
 * `onRecurringChanged` is called instead (many rows may have changed).
 */
export function OneOffDialog({
  oneOff,
  defaults,
  categories,
  items,
  recurring = [],
  startRecurring = false,
  onClose,
  onSaved,
  onRecurringChanged,
}: {
  oneOff: OneOff | null;
  defaults: { month: string; category_id?: string | null; line_item_id?: string | null };
  categories: Category[];
  items: LineItem[];
  /** All recurring entries, to find the one this entry belongs to */
  recurring?: RecurringEntry[];
  /** Pre-check "Repeat every month" (e.g. from "+ Add recurring entry") */
  startRecurring?: boolean;
  onClose: () => void;
  onSaved: (id: string, saved: OneOff | null) => void;
  onRecurringChanged: () => void;
}) {
  const series = oneOff?.recurring_id ? recurring.find((r) => r.id === oneOff.recurring_id) : undefined;
  const initialMonth = parseMonthKey(oneOff?.month ?? defaults.month);
  const [name, setName] = useState(oneOff?.name ?? "");
  const [amountText, setAmountText] = useState(oneOff ? String(oneOff.amount) : "");
  const [monthIdx, setMonthIdx] = useState(initialMonth.month);
  const [yearText, setYearText] = useState(String(initialMonth.year));
  const [categoryId, setCategoryId] = useState(
    oneOff?.category_id ?? items.find((i) => i.id === oneOff?.line_item_id)?.category_id ?? defaults.category_id ?? ""
  );
  const [lineItemId, setLineItemId] = useState(oneOff?.line_item_id ?? defaults.line_item_id ?? "");
  const [note, setNote] = useState(oneOff?.note ?? "");
  const [repeat, setRepeat] = useState(startRecurring);
  const [scope, setScope] = useState<Scope>("this");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeCategories = categories.filter((c) => !c.archived || c.id === categoryId);
  const categoryItems = items.filter(
    (i) => i.category_id === categoryId && (!i.archived || i.id === lineItemId)
  );
  const lineItemName = categoryItems.find((i) => i.id === lineItemId)?.name;
  const typedYear = Number(yearText);
  const month =
    oneOff && series
      ? oneOff.month
      : Number.isInteger(typedYear) && typedYear >= 2000 && typedYear <= 2100
        ? monthKey(typedYear, monthIdx)
        : monthKey(initialMonth.year, monthIdx);
  const monthLabel = formatMonth(month, "short");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryId) return setError("Pick a category");
    // On a line item the name can default to the line's name ("Rent")
    const entryName = name.trim() || lineItemName;
    if (!entryName) return setError("Give it a name, e.g. Hotel");
    const amount = parseAmount(amountText);
    if (amount === null || Number.isNaN(amount)) return setError("Enter an amount like 400 or 399.99");
    if (!Number.isInteger(typedYear) || typedYear < 2000 || typedYear > 2100) return setError("Enter a valid year");
    const fields: EntryFields = { name: entryName, amount, category_id: categoryId, line_item_id: lineItemId || null, note: note || null };

    if (series && oneOff) {
      return run(async () => {
        await updateRecurring(series, fields, scope, oneOff.month, oneOff.id);
        onRecurringChanged();
      });
    }
    if (repeat) {
      return run(async () => {
        if (oneOff) await makeRecurring(oneOff, fields, month);
        else await createRecurring(fields, month);
        onRecurringChanged();
      });
    }
    return run(async () => {
      const saved = await saveOneOff(oneOff?.id ?? null, { ...fields, month, recurring_id: oneOff?.recurring_id ?? null });
      onSaved(saved.id, saved);
    });
  }

  function handleDelete() {
    if (!oneOff) return;
    if (series) return setConfirmingDelete(true);
    if (!window.confirm(`Delete "${oneOff.name}"?`)) return;
    run(async () => {
      await deleteOneOff(oneOff.id);
      onSaved(oneOff.id, null);
    });
  }

  function handleRecurringDelete(s: Scope) {
    if (!series || !oneOff) return;
    run(async () => {
      await removeRecurring(series, s, oneOff.month);
      onRecurringChanged();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {series ? `Edit recurring entry · ${monthLabel}` : oneOff ? "Edit manual entry" : startRecurring ? "Add recurring entry" : "Add manual entry"}
          </DialogTitle>
          <DialogDescription>
            {series
              ? `Repeats every month since ${formatMonth(series.start_month, "short")}${
                  series.end_month ? ` until ${formatMonth(series.end_month, "short")}` : ""
                } at ${formatMoney(series.amount, true)}. Choose below which months your change applies to.`
              : "A named amount for one month, like “Rent $2,000” or “Hotel $500”. It counts toward its category; pick a line item to roll it into that line."}
          </DialogDescription>
        </DialogHeader>
        {confirmingDelete && series && oneOff ? (
          <div className="space-y-3">
            <p className="text-sm">Remove “{oneOff.name}” from which months?</p>
            <div className="grid gap-2">
              <Button variant="outline" disabled={busy} onClick={() => handleRecurringDelete("this")}>
                Skip {monthLabel} only
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => handleRecurringDelete("future")}>
                Stop from {monthLabel} on (earlier months stay)
              </Button>
              <Button variant="destructive" disabled={busy} onClick={() => handleRecurringDelete("all")}>
                Delete every month
              </Button>
            </div>
            <FormError>{error}</FormError>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                Back
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {oneOff && !oneOff.category_id && (
              <p className="rounded-md bg-[var(--color-muted)] px-3 py-2 text-sm">
                This entry has no category yet. Manual entries now always belong to a category; pick one to save it.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="oo-cat">Category</Label>
                <Select
                  id="oo-cat"
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    setLineItemId("");
                  }}
                  required
                >
                  {!categoryId && (
                    <option value="" disabled>
                      Pick a category…
                    </option>
                  )}
                  {activeCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="oo-item">Line item</Label>
                <Select
                  id="oo-item"
                  value={lineItemId}
                  onChange={(e) => setLineItemId(e.target.value)}
                  disabled={!categoryId || categoryItems.length === 0}
                >
                  <option value="">None (shows under Other)</option>
                  {categoryItems.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
              <div className="space-y-2">
                <Label htmlFor="oo-name">What was it?</Label>
                <Input
                  id="oo-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={lineItemName ?? "Hotel"}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="oo-amount">Amount</Label>
                <Input
                  id="oo-amount"
                  inputMode="decimal"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>
            </div>
            {!series && (
              <div className="grid grid-cols-[1fr_6rem] gap-4">
                <div className="space-y-2">
                  <Label htmlFor="oo-month">{repeat ? "Starting" : "Month"}</Label>
                  <Select id="oo-month" value={monthIdx} onChange={(e) => setMonthIdx(Number(e.target.value))}>
                    {MONTH_LONG.map((m, i) => (
                      <option key={m} value={i}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="oo-year">Year</Label>
                  <Input id="oo-year" inputMode="numeric" value={yearText} onChange={(e) => setYearText(e.target.value)} />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="oo-note">Note (optional)</Label>
              <Input id="oo-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Spring break" />
            </div>
            {series ? (
              <fieldset className="space-y-1.5 rounded-md border border-[var(--color-border)] p-3 text-sm">
                <legend className="flex items-center gap-1.5 px-1 font-medium">
                  <Repeat className="h-3.5 w-3.5" aria-hidden /> Apply changes to
                </legend>
                {(
                  [
                    ["this", `${monthLabel} only`],
                    ["future", `${monthLabel} and later months`],
                    ["all", "Every month"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2">
                    <input type="radio" name="oo-scope" className="h-4 w-4" checked={scope === value} onChange={() => setScope(value)} />
                    {label}
                  </label>
                ))}
              </fieldset>
            ) : (
              <label
                className={cn(
                  "flex items-start gap-2 rounded-md border p-3 text-sm",
                  repeat ? "border-[var(--color-primary)]" : "border-[var(--color-border)]"
                )}
              >
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
                <span>
                  <span className="flex items-center gap-1.5 font-medium">
                    <Repeat className="h-3.5 w-3.5" aria-hidden /> Repeat every month from {formatMonth(month, "short")}
                  </span>
                  <span className="block text-xs text-[var(--color-muted-foreground)]">
                    Rent, wages, subscriptions. It's added automatically each month until you stop it; manage it under
                    Recurring on the Month page.
                  </span>
                </span>
              </label>
            )}
            <FormError>{error}</FormError>
            <DialogFooter className="gap-2">
              {oneOff && (
                <Button type="button" variant="destructive" className="sm:mr-auto" onClick={handleDelete} disabled={busy}>
                  Delete
                </Button>
              )}
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
