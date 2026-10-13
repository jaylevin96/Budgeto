import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Check, CheckCheck, Loader2, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-message";
import { EmptyBudget } from "@/components/EmptyBudget";
import { StepperNav } from "@/components/StepperNav";
import { SummaryTiles } from "@/components/SummaryTiles";
import { useBudget } from "@/hooks/useBudget";
import {
  addMonths,
  anomalyHint,
  currentMonthKey,
  formatMoney,
  formatMonth,
  indexAmounts,
  KIND_LABEL,
  monthKeyFromSlug,
  monthSlug,
  parseAmount,
  saveAmount,
  saveAmountsBulk,
  suggestedAmount,
  summarizeMonth,
  sumMoney,
  type AmountIndex,
  type LineItem,
  type MonthlyAmount,
} from "@/lib/budget";
import { cn } from "@/lib/utils";

export function MonthEntry() {
  const params = useParams();
  const navigate = useNavigate();
  const month = monthKeyFromSlug(params.month) ?? currentMonthKey();

  // Load the previous 12 months too, for suggestions and "usually about" hints
  const { categories, items, amounts, loading, error, reload, applyAmount, applyAmounts } = useBudget(
    addMonths(month, -12),
    addMonths(month, 1)
  );
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [filling, setFilling] = useState(false);
  const [fillError, setFillError] = useState<string | null>(null);

  const idx = useMemo(() => indexAmounts(amounts), [amounts]);
  const activeCategories = categories.filter((c) => !c.archived);
  const activeItems = items.filter((i) => !i.archived && activeCategories.some((c) => c.id === i.category_id));
  const summary = summarizeMonth(month, categories, activeItems, idx);
  const prevSummary = summarizeMonth(addMonths(month, -1), categories, activeItems, idx);

  const pendingSuggestions = activeItems
    .filter((i) => idx.get(i.id)?.get(month) === undefined)
    .map((i) => ({ item: i, amount: suggestedAmount(i, month, idx) }))
    .filter((s): s is { item: LineItem; amount: number } => s.amount !== null);

  async function fillSuggestions() {
    setFilling(true);
    setFillError(null);
    try {
      const saved = await saveAmountsBulk(
        pendingSuggestions.map((s) => ({ line_item_id: s.item.id, month, amount: s.amount }))
      );
      applyAmounts(saved);
    } catch (err) {
      setFillError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setFilling(false);
    }
  }

  // Enter moves to the next amount field, like the spreadsheet
  const listRef = useRef<HTMLDivElement>(null);
  const focusNext = useCallback((from: HTMLInputElement) => {
    const inputs = Array.from(listRef.current?.querySelectorAll<HTMLInputElement>("input[data-amount]") ?? []);
    const i = inputs.indexOf(from);
    if (i >= 0 && i + 1 < inputs.length) {
      inputs[i + 1].focus();
      inputs[i + 1].select();
    } else {
      from.blur();
    }
  }, []);

  const go = (delta: number) => navigate(`/month/${monthSlug(addMonths(month, delta))}`);

  if (!loading && !error && categories.length === 0) return <EmptyBudget onSeeded={reload} />;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StepperNav
          label={formatMonth(month)}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          prevLabel="Previous month"
          nextLabel="Next month"
        />
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/settings">
              <Settings2 /> Edit items
            </Link>
          </Button>
        </div>
      </div>

      {error && <FormError>{error}</FormError>}

      {!loading && (
        <>
          <SummaryTiles current={summary} previous={prevSummary} compareLabel="vs last month" />

          <Card>
            <CardContent className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-48 flex-1">
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium">
                    {summary.entered} of {activeItems.length} items entered
                  </span>
                  <span className="text-[var(--color-muted-foreground)]">
                    {activeItems.length ? Math.round((summary.entered / activeItems.length) * 100) : 0}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--color-muted)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-success)] transition-all"
                    style={{ width: `${activeItems.length ? (summary.entered / activeItems.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={onlyMissing}
                  onChange={(e) => setOnlyMissing(e.target.checked)}
                />
                Only show missing
              </label>
              {pendingSuggestions.length > 0 && (
                <Button size="sm" onClick={fillSuggestions} disabled={filling}>
                  <CheckCheck />
                  {filling
                    ? "Saving…"
                    : `Fill ${pendingSuggestions.length} recurring (${formatMoney(sumMoney(pendingSuggestions.map((s) => s.amount)))})`}
                </Button>
              )}
              {fillError && <FormError>{fillError}</FormError>}
            </CardContent>
          </Card>
        </>
      )}

      {loading ? (
        <p className="text-[var(--color-muted-foreground)]">Loading…</p>
      ) : (
        <div ref={listRef} className="space-y-4">
          {activeCategories.map((cat) => {
            const catItems = activeItems.filter((i) => i.category_id === cat.id);
            const visible = onlyMissing ? catItems.filter((i) => idx.get(i.id)?.get(month) === undefined) : catItems;
            if (!visible.length) return null;
            const subtotal = sumMoney(catItems.map((i) => idx.get(i.id)?.get(month) ?? 0));
            return (
              <Card key={cat.id}>
                <div className="flex items-baseline justify-between border-b border-[var(--color-border)] px-4 py-3">
                  <h2 className="font-semibold">
                    {cat.name}
                    <span className="ml-2 text-xs font-normal text-[var(--color-muted-foreground)]">
                      {KIND_LABEL[cat.kind]}
                    </span>
                  </h2>
                  <span className="text-sm font-medium tabular-nums">{formatMoney(subtotal, true)}</span>
                </div>
                <ul className="divide-y divide-[var(--color-border)]">
                  {visible.map((item) => (
                    <AmountRow
                      key={`${item.id}|${month}`}
                      item={item}
                      month={month}
                      idx={idx}
                      onSaved={(saved) => applyAmount(item.id, month, saved)}
                      onEnter={focusNext}
                    />
                  ))}
                </ul>
              </Card>
            );
          })}
          {onlyMissing && summary.entered === activeItems.length && (
            <p className="py-8 text-center text-[var(--color-muted-foreground)]">
              Everything for {formatMonth(month)} is entered.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

function AmountRow({
  item,
  month,
  idx,
  onSaved,
  onEnter,
}: {
  item: LineItem;
  month: string;
  idx: AmountIndex;
  onSaved: (saved: MonthlyAmount | null) => void;
  onEnter: (input: HTMLInputElement) => void;
}) {
  const value = idx.get(item.id)?.get(month);
  const suggestion = value === undefined ? suggestedAmount(item, month, idx) : null;
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const focused = useRef(false);
  const cancelled = useRef(false);

  // Keep in sync with outside changes (e.g. "Fill recurring") while not editing
  useEffect(() => {
    if (!focused.current) setText(value === undefined ? "" : String(value));
  }, [value]);

  async function commit(raw: string) {
    const parsed = parseAmount(raw);
    if (Number.isNaN(parsed)) {
      setState("error");
      setMessage("Enter a number like 125 or 125.40");
      return;
    }
    if ((parsed ?? undefined) === value) {
      setState("idle");
      setMessage(null);
      return;
    }
    setState("saving");
    setMessage(null);
    try {
      const saved = await saveAmount(item.id, month, parsed);
      onSaved(saved);
      setText(parsed === null ? "" : String(parsed));
      setState("saved");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Could not save");
    }
  }

  const hint = value !== undefined && value > 0 ? anomalyHint(item, month, value, idx) : null;
  const inputId = `amt-${item.id}`;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
      <label htmlFor={inputId} className="min-w-0 flex-1">
        <span className={cn("block truncate", value === undefined && "text-[var(--color-muted-foreground)]")}>
          {item.name}
        </span>
        {item.recurrence !== "none" && (
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {item.recurrence === "fixed" ? "Fixed" : "Monthly"}
          </span>
        )}
      </label>
      <div className="flex items-center gap-1.5">
        {suggestion !== null && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 px-2 text-xs"
            onClick={() => commit(String(suggestion))}
            aria-label={`Use ${formatMoney(suggestion, true)} for ${item.name}`}
            title={item.recurrence === "fixed" ? "Use the usual amount" : "Use last month's amount"}
          >
            <Check /> {formatMoney(suggestion)}
          </Button>
        )}
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted-foreground)]">
            $
          </span>
          <input
            id={inputId}
            data-amount
            inputMode="decimal"
            autoComplete="off"
            className={cn(
              "h-9 w-32 rounded-md border bg-transparent pl-6 pr-7 text-right text-base tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] md:text-sm",
              state === "error" ? "border-[var(--color-destructive)]" : "border-[var(--color-input)]",
              value === undefined && "border-dashed"
            )}
            placeholder="—"
            value={text}
            onFocus={(e) => {
              focused.current = true;
              e.target.select();
            }}
            onChange={(e) => {
              setText(e.target.value);
              if (state !== "idle") setState("idle");
            }}
            onBlur={(e) => {
              focused.current = false;
              if (cancelled.current) {
                cancelled.current = false;
                return;
              }
              commit(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEnter(e.currentTarget);
              } else if (e.key === "Escape") {
                cancelled.current = true;
                setText(value === undefined ? "" : String(value));
                e.currentTarget.blur();
              }
            }}
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2" aria-live="polite">
            {state === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-muted-foreground)]" />}
            {state === "saved" && <Check className="h-3.5 w-3.5 text-[var(--color-success)]" aria-label="Saved" />}
            {state === "error" && <X className="h-3.5 w-3.5 text-[var(--color-destructive)]" aria-label="Not saved" />}
          </span>
        </div>
      </div>
      {(message || hint) && (
        <p
          className={cn(
            "flex w-full items-center justify-end gap-1 text-xs",
            message ? "text-[var(--color-destructive)]" : "text-[var(--color-warning)]"
          )}
        >
          {!message && <AlertTriangle className="h-3 w-3" aria-hidden />}
          {message ?? `${hint}, double-check this amount`}
        </p>
      )}
    </li>
  );
}
