import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { addMonths, currentMonthKey, formatMoney, formatMonth, parseAmount, sumMoney, type Category, type LineItem } from "@/lib/budget";
import {
  activeIn,
  removeRecurring,
  restartRecurring,
  stopRecurring,
  unskipRecurring,
  updateRecurring,
  type RecurringEntry,
} from "@/lib/recurring";
import { cn } from "@/lib/utils";

/**
 * The Month page's "Recurring" card: every recurring entry that covers this month, with its
 * amount and since/until, plus stopped ones to restart. Each opens a dialog to change it from
 * this month on (or every month), skip this month, or stop it.
 */
export function RecurringPanel({
  month,
  recurring,
  categories,
  items,
  onAdd,
  onChanged,
}: {
  month: string;
  recurring: RecurringEntry[];
  categories: Category[];
  items: LineItem[];
  onAdd: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<RecurringEntry | null>(null);
  const [showStopped, setShowStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = recurring.filter((r) => r.start_month <= month && (r.end_month === null || month <= r.end_month));
  const stopped = recurring.filter((r) => r.end_month !== null && r.end_month < month);
  const upcoming = recurring.filter((r) => r.start_month > month);
  const monthly = sumMoney(active.filter((r) => activeIn(r, month)).map((r) => r.amount));
  const where = (r: RecurringEntry) =>
    [categories.find((c) => c.id === r.category_id)?.name, items.find((i) => i.id === r.line_item_id)?.name]
      .filter(Boolean)
      .join(" › ");

  async function restart(r: RecurringEntry) {
    setError(null);
    try {
      await restartRecurring(r, month);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restart");
    }
  }

  const row = (r: RecurringEntry, extra: React.ReactNode, muted = false) => (
    <li key={r.id}>
      <button
        type="button"
        onClick={() => setEditing(r)}
        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-[var(--color-accent)]"
        aria-label={`Manage recurring entry ${r.name}`}
      >
        <Repeat className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-medium", muted && "text-[var(--color-muted-foreground)]")}>{r.name}</span>
          <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
            {[where(r), extra].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className={cn("font-medium tabular-nums", muted && "text-[var(--color-muted-foreground)]")}>
          {formatMoney(r.amount, true)}
        </span>
      </button>
    </li>
  );

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Repeat className="h-4 w-4" aria-hidden /> Recurring
        </h2>
        {active.length > 0 && (
          <span className="text-sm text-[var(--color-muted-foreground)]">
            <span className="font-medium tabular-nums text-[var(--color-foreground)]">{formatMoney(monthly)}</span> this month
          </span>
        )}
      </div>
      {active.length === 0 && upcoming.length === 0 && (
        <p className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
          Nothing recurring yet. Add rent, wages or subscriptions once and they're filled in every month.
        </p>
      )}
      <ul className="divide-y divide-[var(--color-border)] empty:hidden">
        {active.map((r) =>
          row(
            r,
            r.skip_months.includes(month)
              ? `skipped in ${formatMonth(month, "short")}`
              : `since ${formatMonth(r.start_month, "short")}${r.end_month ? ` until ${formatMonth(r.end_month, "short")}` : ""}`,
            r.skip_months.includes(month)
          )
        )}
        {upcoming.map((r) => row(r, `starts ${formatMonth(r.start_month, "short")}`, true))}
      </ul>
      {stopped.length > 0 && (
        <div className="border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => setShowStopped((v) => !v)}
            aria-expanded={showStopped}
            className="flex w-full items-center gap-1 px-4 py-2 text-left text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            {showStopped ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Stopped ({stopped.length})
          </button>
          {showStopped && (
            <ul className="divide-y divide-[var(--color-border)]">
              {stopped.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--color-muted-foreground)]">{r.name}</span>
                    <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                      {where(r)} · {formatMonth(r.start_month, "short")} – {formatMonth(r.end_month!, "short")}
                    </span>
                  </span>
                  <span className="tabular-nums text-[var(--color-muted-foreground)]">{formatMoney(r.amount, true)}</span>
                  <Button variant="outline" size="sm" onClick={() => restart(r)}>
                    Restart from {formatMonth(month, "short")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && (
        <div className="px-4 pb-2">
          <FormError>{error}</FormError>
        </div>
      )}
      <div className="border-t border-[var(--color-border)] px-2 py-1.5">
        <Button variant="ghost" size="sm" className="text-[var(--color-primary)]" onClick={onAdd}>
          <Plus /> Add recurring entry
        </Button>
      </div>
      {editing && (
        <RecurringDialog
          entry={editing}
          month={month}
          categories={categories}
          items={items}
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

/** Change, skip, stop or delete a recurring entry, as of the month being viewed. */
function RecurringDialog({
  entry,
  month,
  categories,
  items,
  onClose,
  onChanged,
}: {
  entry: RecurringEntry;
  month: string;
  categories: Category[];
  items: LineItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(entry.name);
  const [amountText, setAmountText] = useState(String(entry.amount));
  const [categoryId, setCategoryId] = useState(entry.category_id);
  const [lineItemId, setLineItemId] = useState(entry.line_item_id ?? "");
  const [note, setNote] = useState(entry.note ?? "");
  const [scope, setScope] = useState<"future" | "all">("future");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Changes apply from the viewed month, or from the start if it hasn't started yet
  const from = month < entry.start_month ? entry.start_month : month;
  const fromLabel = formatMonth(from, "short");
  const prevLabel = formatMonth(addMonths(from, -1), "short");
  const isCurrentOrPast = from <= currentMonthKey();
  const skipped = entry.skip_months.includes(month);
  const categoryItems = items.filter((i) => i.category_id === categoryId && (!i.archived || i.id === lineItemId));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give it a name, e.g. Rent");
    const amount = parseAmount(amountText);
    if (amount === null || Number.isNaN(amount)) return setError("Enter an amount like 2000 or 15.99");
    run(() =>
      updateRecurring(entry, { name, amount, category_id: categoryId, line_item_id: lineItemId || null, note: note || null }, scope, from)
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="h-4 w-4" aria-hidden /> {entry.name}
          </DialogTitle>
          <DialogDescription>
            Every month since {formatMonth(entry.start_month, "short")}
            {entry.end_month ? ` until ${formatMonth(entry.end_month, "short")}` : ", until you stop it"}. Months up to now are
            already filled in; edit one month on its own from its category.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <div className="space-y-2">
              <Label htmlFor="re-name">Name</Label>
              <Input id="re-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="re-amount">Amount</Label>
              <Input id="re-amount" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="re-cat">Category</Label>
              <Select
                id="re-cat"
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setLineItemId("");
                }}
              >
                {categories
                  .filter((c) => !c.archived || c.id === categoryId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="re-item">Line item</Label>
              <Select id="re-item" value={lineItemId} onChange={(e) => setLineItemId(e.target.value)} disabled={!categoryItems.length}>
                <option value="">None (shows under Other)</option>
                {categoryItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="re-note">Note (optional)</Label>
            <Input id="re-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <fieldset className="space-y-1.5 rounded-md border border-[var(--color-border)] p-3 text-sm">
            <legend className="px-1 font-medium">Apply changes to</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="re-scope" className="h-4 w-4" checked={scope === "future"} onChange={() => setScope("future")} />
              {fromLabel} and later (earlier months keep their amounts)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="re-scope" className="h-4 w-4" checked={scope === "all"} onChange={() => setScope("all")} />
              Every month, including past ones
            </label>
          </fieldset>
          <FormError>{error}</FormError>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
        <div className="space-y-2 border-t border-[var(--color-border)] pt-4">
          <p className="text-xs font-medium text-[var(--color-muted-foreground)]">Stop or skip</p>
          <div className="flex flex-wrap gap-2">
            {isCurrentOrPast && !skipped && month >= entry.start_month && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => removeRecurring(entry, "this", month))}>
                Skip {formatMonth(month, "short")} only
              </Button>
            )}
            {skipped && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => unskipRecurring(entry, month))}>
                Un-skip {formatMonth(month, "short")}
              </Button>
            )}
            {from > entry.start_month && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => stopRecurring(entry, addMonths(from, -1)))}>
                Stop after {prevLabel}
              </Button>
            )}
            <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => stopRecurring(entry, from))}>
              Stop after {fromLabel}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() =>
                window.confirm(`Delete "${entry.name}" and every month it added?`) && run(() => removeRecurring(entry, "all", from))
              }
            >
              Delete every month
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
