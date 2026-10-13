import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-message";
import {
  addMonths,
  currentMonthKey,
  deleteOneOff,
  formatMoney,
  formatMonth,
  MONTH_SHORT,
  parseAmount,
  parseMonthKey,
  type OneOff,
} from "@/lib/budget";
import { enterAmount, removeRecurring, setOccurrenceAmount, type RecurringEntry } from "@/lib/recurring";
import { cn } from "@/lib/utils";

/**
 * Enter (or change) one month's amount for a recurring entry whose amount changes each month.
 * Shows the last three due months for context, with "Same as Sep", "$0" and skip/clear shortcuts.
 */
export function VaryingAmountForm({
  recurring,
  month,
  oneOffs,
  onSaved,
  onSkipped,
}: {
  recurring: RecurringEntry;
  month: string;
  /** Manual entries loaded for this month and the few before it */
  oneOffs: OneOff[];
  /** The month's amount was entered or changed (`saved`), or cleared (`saved` null) */
  onSaved: (id: string, saved: OneOff | null) => void;
  onSkipped: () => void;
}) {
  const entry = oneOffs.find((o) => o.recurring_id === recurring.id && o.month === month);
  const [text, setText] = useState(entry ? String(entry.amount) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mon = (m: string) => MONTH_SHORT[parseMonthKey(m).month];
  const history = [3, 2, 1].map((k) => {
    const m = addMonths(month, -k * recurring.every_months);
    return { month: m, amount: oneOffs.find((o) => o.recurring_id === recurring.id && o.month === m)?.amount };
  });
  const last = [...history].reverse().find((h) => h.amount !== undefined);
  const parsed = parseAmount(text);
  const unchanged = entry !== undefined && parsed === entry.amount;
  const missing = !entry && month <= currentMonthKey();

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

  const save = (amount: number) =>
    run(async () => {
      const saved = entry ? await setOccurrenceAmount(entry.id, amount) : await enterAmount(recurring, month, amount);
      onSaved(saved.id, saved);
    });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (parsed === null) return setError("Type an amount (0 is fine), or skip this month");
    if (Number.isNaN(parsed)) return setError("Enter an amount like 85 or 85.50");
    save(parsed);
  }

  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border p-4",
        missing ? "border-[var(--color-warning)] bg-[var(--color-warning)]/5" : "border-[var(--color-border)]"
      )}
    >
      <div>
        <p className="text-base font-semibold">Amount for {formatMonth(month)}</p>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {entry
            ? `Entered: ${formatMoney(entry.amount, true)}. Change it below.`
            : month > currentMonthKey()
              ? "Not entered yet. You can enter it ahead of time."
              : "Not entered yet, so it isn't counted this month."}{" "}
          Other months keep their own amounts.
        </p>
      </div>
      <p className="text-xs text-[var(--color-muted-foreground)]">
        Recent:{" "}
        {history.map((h, i) => (
          <span key={h.month}>
            {i > 0 && " · "}
            {mon(h.month)} {h.amount === undefined ? "—" : formatMoney(h.amount, true)}
          </span>
        ))}
      </p>
      <form onSubmit={submit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)]">
            $
          </span>
          <input
            autoFocus
            inputMode="decimal"
            autoComplete="off"
            className={cn(
              "h-11 w-full rounded-md border bg-[var(--color-background)] pl-7 pr-3 text-right text-lg tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
              missing ? "border-[var(--color-warning)]" : "border-[var(--color-input)]"
            )}
            placeholder="0.00"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            aria-label={`${recurring.name} amount for ${formatMonth(month)}`}
          />
        </div>
        <Button type="submit" className="h-11" disabled={busy || unchanged}>
          {busy ? "Saving…" : `Save for ${mon(month)}`}
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        {last && !(entry && entry.amount === last.amount) && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => save(last.amount!)}>
            Same as {mon(last.month)} ({formatMoney(last.amount!, true)})
          </Button>
        )}
        {!(entry && entry.amount === 0) && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => save(0)}>
            $0 for {mon(month)}
          </Button>
        )}
        {entry ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await deleteOneOff(entry.id);
                onSaved(entry.id, null);
              })
            }
          >
            Clear {mon(month)}'s amount
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            title="It doesn't apply this month; nothing is recorded"
            onClick={() =>
              run(async () => {
                await removeRecurring(recurring, "this", month);
                onSkipped();
              })
            }
          >
            Skip {mon(month)}
          </Button>
        )}
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}
