import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  addMonths,
  currentMonthKey,
  formatMoney,
  formatMonth,
  KIND_LABEL,
  parseAmount,
  sumMoney,
  type Category,
  type CategoryKind,
  type LineItem,
  type OneOff,
} from "@/lib/budget";
import {
  needingAmount,
  removeRecurring,
  restartRecurring,
  setAmountVaries,
  stopRecurring,
  unskipRecurring,
  updateRecurring,
  type RecurringEntry,
} from "@/lib/recurring";
import { cn } from "@/lib/utils";

/**
 * The Month page's "Recurring" card: a breakdown of what recurring entries bring into this
 * month, grouped into income / spending / savings with subtotals, each with its amount this
 * month and what changed since last month (new, amount changed, edited for this month,
 * skipped, ended). Stopped ones can be restarted. Each opens a dialog to change it from this
 * month on (or every month), skip this month, or stop it.
 */
export function RecurringPanel({
  month,
  recurring,
  oneOffs,
  categories,
  items,
  onAdd,
  onChanged,
}: {
  month: string;
  recurring: RecurringEntry[];
  /** Manual entries loaded for this month and the month before (to show actual amounts and changes) */
  oneOffs: OneOff[];
  categories: Category[];
  items: LineItem[];
  onAdd: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<RecurringEntry | null>(null);
  const [showStopped, setShowStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prevMonth = addMonths(month, -1);
  const isFuture = month > currentMonthKey();
  const active = recurring.filter((r) => r.start_month <= month && (r.end_month === null || month <= r.end_month));
  const stopped = recurring.filter((r) => r.end_month !== null && r.end_month < month);
  const endedLastMonth = stopped.filter((r) => r.end_month === prevMonth);
  const upcoming = recurring.filter((r) => r.start_month > month);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const where = (r: RecurringEntry) =>
    [catById.get(r.category_id)?.name, items.find((i) => i.id === r.line_item_id)?.name].filter(Boolean).join(" › ");
  const occurrence = (r: RecurringEntry, m: string) => oneOffs.find((o) => o.recurring_id === r.id && o.month === m);

  /** Last known amount for a varying entry: last month's, else the template's */
  const hintFor = (r: RecurringEntry) => occurrence(r, prevMonth)?.amount ?? r.amount;
  // Varying entries with no amount yet for this month (entered in the card at the top of the page)
  const needsAmount = needingAmount(recurring, oneOffs, month);

  /** What this entry brings into the month, and how that compares with last month */
  const lines = active.map((r) => {
    const skipped = r.skip_months.includes(month);
    const pending = needsAmount.includes(r);
    const occ = occurrence(r, month);
    // Past and current months have a real entry; future months show what will come in
    // (a varying amount isn't known yet, so it isn't counted)
    const estimate = isFuture && r.amount_varies && !skipped;
    const amount = skipped || estimate || pending ? 0 : (occ?.amount ?? (isFuture ? r.amount : 0));
    const prev = occurrence(r, prevMonth)?.amount;
    const notes: string[] = [];
    if (estimate || pending) notes.push(`last ${formatMoney(hintFor(r), true)}`);
    else if (skipped) notes.push(`skipped in ${formatMonth(month, "short")}`);
    else if (r.start_month === month) notes.push("new this month");
    else if (prev === undefined && r.start_month <= prevMonth)
      notes.push(r.amount_varies ? `nothing entered for ${formatMonth(prevMonth, "short")}` : `skipped in ${formatMonth(prevMonth, "short")}`);
    else if (prev !== undefined && prev !== amount) {
      const d = amount - prev;
      notes.push(`${d > 0 ? "up" : "down"} ${formatMoney(Math.abs(d), true)} from ${formatMoney(prev, true)} in ${formatMonth(prevMonth, "short")}`);
    }
    if (occ && occ.amount !== r.amount && !skipped && !r.amount_varies) notes.push(`usually ${formatMoney(r.amount, true)}`);
    if (r.end_month === month) notes.push(`last month: stops after ${formatMonth(month, "short")}`);
    return { r, amount, skipped, estimate, pending, notes, kind: catById.get(r.category_id)?.kind ?? ("expense" as CategoryKind) };
  });
  const groups = (["income", "expense", "savings"] as const)
    .map((kind) => ({ kind, lines: lines.filter((l) => l.kind === kind) }))
    .filter((g) => g.lines.length > 0)
    .map((g) => ({ ...g, total: sumMoney(g.lines.map((l) => l.amount)) }));
  /** Income comes in (+, green); spending and savings go out (−) */
  const signed = (kind: CategoryKind, n: number, cents = false) =>
    n === 0 ? formatMoney(0, cents) : `${kind === "income" ? "+" : "−"}${formatMoney(Math.abs(n), cents)}`;
  const tone = (kind: CategoryKind) => (kind === "income" ? "text-[var(--color-success)]" : "");
  const totalOf = (kind: CategoryKind) => groups.find((g) => g.kind === kind)?.total ?? 0;
  const net = sumMoney([totalOf("income"), -totalOf("expense"), -totalOf("savings")]);

  async function restart(r: RecurringEntry) {
    setError(null);
    try {
      await restartRecurring(r, month);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restart");
    }
  }

  const kindOf = (r: RecurringEntry): CategoryKind => catById.get(r.category_id)?.kind ?? "expense";
  /** `badge` replaces the amount (e.g. a varying amount not entered yet) */
  const row = (r: RecurringEntry, amount: number, notes: string[], muted = false, badge?: React.ReactNode) => (
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
            {where(r)}
            {notes.map((n) => (
              <span key={n} className={cn(/^(new|up|down|skipped|last)/.test(n) && "font-medium text-[var(--color-foreground)]")}>
                {" · "}
                {n}
              </span>
            ))}
          </span>
        </span>
        <span
          className={cn(
            "font-medium tabular-nums",
            muted ? "text-[var(--color-muted-foreground)] line-through" : tone(kindOf(r))
          )}
        >
          {badge ?? signed(kindOf(r), muted ? r.amount : amount, true)}
        </span>
      </button>
    </li>
  );

  return (
    <Card>
      <div className="space-y-2 border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <Repeat className="h-4 w-4" aria-hidden /> Recurring
          </h2>
          {lines.length > 0 && (
            <span className="text-xs text-[var(--color-muted-foreground)]">
              {isFuture ? `Scheduled for ${formatMonth(month, "short")}` : `Added to ${formatMonth(month, "short")}`}
              {needsAmount.length > 0 && ` · ${needsAmount.length} still need an amount`}
            </span>
          )}
        </div>
        {groups.length > 0 && (
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {groups.map((g) => (
              <div key={g.kind} className="flex items-baseline gap-1.5">
                <dt className="text-[var(--color-muted-foreground)]">{KIND_LABEL[g.kind]}</dt>
                <dd className={cn("font-medium tabular-nums", tone(g.kind))}>{signed(g.kind, g.total)}</dd>
              </div>
            ))}
            {groups.length > 1 && (
              <div className="flex items-baseline gap-1.5">
                <dt className="text-[var(--color-muted-foreground)]">Net</dt>
                <dd
                  className={cn(
                    "font-semibold tabular-nums",
                    net < 0 ? "text-[var(--color-destructive)]" : net > 0 && "text-[var(--color-success)]"
                  )}
                >
                  {net > 0 ? "+" : net < 0 ? "−" : ""}
                  {formatMoney(Math.abs(net))}
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>
      {lines.length === 0 && upcoming.length === 0 && (
        <p className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
          Nothing recurring yet. Add rent, wages or subscriptions once and they're filled in every month.
        </p>
      )}
      {groups.map((g) => (
        <div key={g.kind} className="border-b border-[var(--color-border)] last:border-b-0">
          <div className="flex items-baseline justify-between bg-[var(--color-muted)]/50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            <span>
              {g.kind === "income" ? "Coming in" : g.kind === "savings" ? "Going to savings" : "Going out"} · {KIND_LABEL[g.kind]} ({g.lines.length})
            </span>
            <span className={cn("tabular-nums", tone(g.kind))}>{signed(g.kind, g.total, true)}</span>
          </div>
          <ul className="divide-y divide-[var(--color-border)]">
            {[...g.lines]
              .sort((a, b) => Number(b.pending) - Number(a.pending) || b.amount - a.amount)
              .map((l) =>
                row(
                  l.r,
                  l.amount,
                  l.notes,
                  l.skipped,
                  l.pending ? (
                    <Badge tone="warning">Needs amount</Badge>
                  ) : l.estimate ? (
                    <Badge tone="muted">Amount varies</Badge>
                  ) : undefined
                )
              )}
          </ul>
        </div>
      ))}
      {endedLastMonth.length > 0 && (
        <div className="border-t border-[var(--color-border)]">
          <p className="px-4 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Not coming in anymore
          </p>
          <ul className="divide-y divide-[var(--color-border)]">
            {endedLastMonth.map((r) => row(r, 0, [`stopped after ${formatMonth(prevMonth, "short")}`], true))}
          </ul>
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="border-t border-[var(--color-border)]">
          <p className="px-4 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Starting later</p>
          <ul className="divide-y divide-[var(--color-border)]">
            {upcoming.map((r) => row(r, r.amount, [`starts ${formatMonth(r.start_month, "short")}`]))}
          </ul>
        </div>
      )}
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
  const [varies, setVaries] = useState(entry.amount_varies);
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
    // A varying entry has no single amount; each month's is entered on its own
    const amount = varies ? entry.amount : parseAmount(amountText);
    if (amount === null || Number.isNaN(amount)) return setError("Enter an amount like 2000 or 15.99 (0 is fine)");
    run(async () => {
      await updateRecurring(
        { ...entry, amount_varies: varies },
        { name, amount, category_id: categoryId, line_item_id: lineItemId || null, note: note || null },
        scope,
        from
      );
      if (varies !== entry.amount_varies) await setAmountVaries(entry, varies);
    });
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
          <div className={cn("grid gap-4", !varies && "sm:grid-cols-[1fr_9rem]")}>
            <div className="space-y-2">
              <Label htmlFor="re-name">Name</Label>
              <Input id="re-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {!varies && (
              <div className="space-y-2">
                <Label htmlFor="re-amount">Amount each month</Label>
                <Input id="re-amount" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
              </div>
            )}
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
            <legend className="px-1 font-medium">Amount</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="re-varies" className="h-4 w-4" checked={!varies} onChange={() => setVaries(false)} />
              Same every month (filled in automatically)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="re-varies" className="h-4 w-4" checked={varies} onChange={() => setVaries(true)} />
              Changes each month (asks for it each month)
            </label>
          </fieldset>
          <fieldset className="space-y-1.5 rounded-md border border-[var(--color-border)] p-3 text-sm">
            <legend className="px-1 font-medium">Apply changes to</legend>
            {varies && (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Each month keeps the amount entered for it (enter it at the top of the Month page); name, category,
                line item and note carry over.
              </p>
            )}
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

function Badge({ tone, children }: { tone: "warning" | "muted"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
        tone === "warning"
          ? "bg-[var(--color-warning)]/15 text-[var(--color-warning)] ring-1 ring-[var(--color-warning)]/40"
          : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
      )}
    >
      {children}
    </span>
  );
}
