import { useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-message";
import { addMonths, formatMoney, formatMonth, MONTH_SHORT, parseAmount, parseMonthKey, type Category, type LineItem, type OneOff } from "@/lib/budget";
import { enterAmount, needingAmount, removeRecurring, type RecurringEntry } from "@/lib/recurring";

/**
 * Top of the Month page: recurring entries whose amount changes each month and that don't
 * have this month's amount yet (utilities, childcare). Each row shows the last few months for
 * context; type the amount and press Enter (or use last month's, or $0), or skip the month.
 * Nothing shows once they're all entered.
 */
export function VaryingAmountsCard({
  month,
  recurring,
  oneOffs,
  categories,
  items,
  onEntered,
  onSkipped,
}: {
  month: string;
  recurring: RecurringEntry[];
  /** Manual entries loaded for this month and the few before it (for history) */
  oneOffs: OneOff[];
  categories: Category[];
  items: LineItem[];
  onEntered: (saved: OneOff) => void;
  onSkipped: () => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const due = needingAmount(recurring, oneOffs, month);
  if (!due.length) return null;

  // After saving one, move to the next row's input
  const focusAfter = (id: string) => {
    const inputs = Array.from(listRef.current?.querySelectorAll<HTMLInputElement>("input[data-varying]") ?? []);
    const next = inputs.find((el) => el.dataset.varying !== id);
    next?.focus();
  };

  return (
    <Card className="overflow-hidden border-[var(--color-warning)] ring-1 ring-[var(--color-warning)]/30">
      <div className="flex items-start gap-3 bg-[var(--color-warning)]/10 px-4 py-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-warning)]" aria-hidden />
        <div>
          <h2 className="font-semibold">
            Enter {formatMonth(month)} amounts ({due.length})
          </h2>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            These come every month but the amount changes. They aren't counted until you enter them.
          </p>
        </div>
      </div>
      <ul ref={listRef} className="divide-y divide-[var(--color-border)]">
        {due.map((r) => (
          <VaryingRow
            key={r.id}
            entry={r}
            month={month}
            oneOffs={oneOffs}
            where={[categories.find((c) => c.id === r.category_id)?.name, items.find((i) => i.id === r.line_item_id)?.name]
              .filter(Boolean)
              .join(" › ")}
            onEntered={(saved) => {
              focusAfter(r.id);
              onEntered(saved);
            }}
            onSkipped={onSkipped}
          />
        ))}
      </ul>
    </Card>
  );
}

function VaryingRow({
  entry,
  month,
  oneOffs,
  where,
  onEntered,
  onSkipped,
}: {
  entry: RecurringEntry;
  month: string;
  oneOffs: OneOff[];
  where: string;
  onEntered: (saved: OneOff) => void;
  onSkipped: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The last three months, oldest first, for context
  const history = [3, 2, 1].map((k) => {
    const m = addMonths(month, -k);
    return { month: m, amount: oneOffs.find((o) => o.recurring_id === entry.id && o.month === m)?.amount };
  });
  const last = [...history].reverse().find((h) => h.amount !== undefined);
  const mon = (m: string) => MONTH_SHORT[parseMonthKey(m).month];

  async function save(amount: number) {
    setBusy(true);
    setError(null);
    try {
      onEntered(await enterAmount(entry, month, amount));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseAmount(text);
    if (amount === null) return setError("Type an amount (0 is fine), or skip this month");
    if (Number.isNaN(amount)) return setError("Enter an amount like 85 or 85.50");
    save(amount);
  }

  async function skip() {
    setBusy(true);
    setError(null);
    try {
      await removeRecurring(entry, "this", month);
      onSkipped();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not skip");
      setBusy(false);
    }
  }

  const inputId = `varying-${entry.id}`;
  return (
    <li className="space-y-2 px-4 py-3">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label htmlFor={inputId} className="min-w-0 flex-1 basis-48">
          <span className="block truncate font-medium">{entry.name}</span>
          <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
            {where}
            {history.map((h) => (
              <span key={h.month}>
                {" · "}
                {mon(h.month)} {h.amount === undefined ? "—" : formatMoney(h.amount)}
              </span>
            ))}
          </span>
        </label>
        <div className="flex items-center gap-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted-foreground)]">
              $
            </span>
            <input
              id={inputId}
              data-varying={entry.id}
              inputMode="decimal"
              autoComplete="off"
              className="h-10 w-32 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] pl-6 pr-2 text-right text-base tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              placeholder="0.00"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {last && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => save(last.amount!)}>
            Same as {mon(last.month)} ({formatMoney(last.amount!, true)})
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => save(0)}>
          $0 this month
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={skip}
          title="It doesn't apply this month; nothing is recorded"
        >
          Skip {mon(month)}
        </Button>
      </div>
      <FormError>{error}</FormError>
    </li>
  );
}
