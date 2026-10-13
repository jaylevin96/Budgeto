import { useCallback, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Check, CheckCheck, CreditCard, MessageSquare, Plus, Settings2, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-message";
import { AmountInput } from "@/components/AmountInput";
import { useCellSaver } from "@/hooks/useCellSaver";
import { BudgetBar } from "@/components/BudgetBar";
import { CardTransactionsDialog } from "@/components/CardTransactions";
import { EmptyBudget } from "@/components/EmptyBudget";
import { OneOffDialog } from "@/components/OneOffDialog";
import { OneOffList } from "@/components/OneOffList";
import { StepperNav } from "@/components/StepperNav";
import { SummaryTiles } from "@/components/SummaryTiles";
import { useBudget } from "@/hooks/useBudget";
import {
  addMonths,
  anomalyHint,
  categoryCard,
  categoryOneOffs,
  currentMonthKey,
  formatMoney,
  formatMonth,
  itemCard,
  itemEntered,
  itemMonthTotal,
  itemOneOffs,
  KIND_LABEL,
  monthKeyFromSlug,
  monthSlug,
  saveAmountsBulk,
  saveNote,
  suggestedAmount,
  summarizeMonth,
  sumMoney,
  totalForCategoryMonth,
  uncategorizedCard,
  type Ledger,
  type LineItem,
  type MonthlyAmount,
  type OneOff,
} from "@/lib/budget";
import type { Transaction } from "@/lib/transactions";
import { cn } from "@/lib/utils";

type EditingOneOff = { oneOff: OneOff | null; category_id?: string | null; line_item_id?: string | null } | null;

export function MonthEntry() {
  const params = useParams();
  const navigate = useNavigate();
  const month = monthKeyFromSlug(params.month) ?? currentMonthKey();

  // Load the previous 12 months too, for suggestions and "usually about" hints
  const {
    categories,
    items,
    oneOffs,
    transactions,
    ledger,
    loading,
    error,
    reload,
    applyAmount,
    applyAmounts,
    applyOneOff,
    applyTransactions,
    applyCreated,
  } = useBudget(addMonths(month, -12), addMonths(month, 1));
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [filling, setFilling] = useState(false);
  const [fillError, setFillError] = useState<string | null>(null);
  const [editingOneOff, setEditingOneOff] = useState<EditingOneOff>(null);
  // Which card charges the dialog shows (a snapshot, so a reassigned charge stays in view)
  const [cardDialog, setCardDialog] = useState<{ title: string; description: string; ids: Set<string> } | null>(null);

  const idx = ledger.idx;
  const activeCategories = categories.filter((c) => !c.archived);
  const activeItems = items.filter((i) => !i.archived && activeCategories.some((c) => c.id === i.category_id));
  const summary = summarizeMonth(ledger, month);
  const prevSummary = summarizeMonth(ledger, addMonths(month, -1));
  const monthOneOffs = oneOffs.filter((o) => o.month === month);
  const unfiled = uncategorizedCard(ledger, month);

  // Items paid by card this month don't get a typed suggestion (it would count twice)
  const pendingSuggestions = activeItems
    .filter((i) => !itemEntered(ledger, i.id, month))
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
  const enteredCount = activeItems.filter((i) => itemEntered(ledger, i.id, month)).length;

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
          <Button variant="outline" size="sm" onClick={() => setEditingOneOff({ oneOff: null })}>
            <Plus /> Entry
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/import/card">
              <CreditCard /> Import Amex
            </Link>
          </Button>
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
                    {enteredCount} of {activeItems.length} items entered
                  </span>
                  <span className="text-[var(--color-muted-foreground)]">
                    {activeItems.length ? Math.round((enteredCount / activeItems.length) * 100) : 0}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--color-muted)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-success)] transition-all"
                    style={{ width: `${activeItems.length ? (enteredCount / activeItems.length) * 100 : 0}%` }}
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

          {unfiled.length > 0 && (
            <Card className="border-[var(--color-warning)]">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <p className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--color-warning)]" aria-hidden />
                  <span>
                    {unfiled.length} card {unfiled.length === 1 ? "charge isn't" : "charges aren't"} filed under a line
                    item ({formatMoney(sumMoney(unfiled.map((t) => t.amount)), true)}).{" "}
                    {unfiled.length === 1 ? "It counts" : "They count"} as uncategorized spending until you file{" "}
                    {unfiled.length === 1 ? "it" : "them"}.
                  </span>
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setCardDialog({
                      title: `Unfiled card charges · ${formatMonth(month)}`,
                      description:
                        "Pick a line item for each. If you already added a purchase as an entry, link it so it isn't counted twice. Choose “Don't count” for anything that isn't household spending.",
                      ids: new Set(unfiled.map((t) => t.id)),
                    })
                  }
                >
                  Review
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {loading ? (
        <p className="text-[var(--color-muted-foreground)]">Loading…</p>
      ) : (
        <div ref={listRef} className="space-y-4">
          {activeCategories.map((cat) => {
            const catItems = activeItems.filter((i) => i.category_id === cat.id);
            const visible = onlyMissing ? catItems.filter((i) => !itemEntered(ledger, i.id, month)) : catItems;
            const catOneOffs = categoryOneOffs(ledger, cat.id, month);
            const catCard = categoryCard(ledger, cat.id, month);
            if (onlyMissing && !visible.length) return null;
            const subtotal = totalForCategoryMonth(ledger, cat.id, month);
            return (
              <Card key={cat.id}>
                <div className="space-y-2 border-b border-[var(--color-border)] px-4 py-3">
                  <div className="flex items-baseline justify-between">
                    <h2 className="font-semibold">
                      {cat.name}
                      <span className="ml-2 text-xs font-normal text-[var(--color-muted-foreground)]">
                        {KIND_LABEL[cat.kind]}
                      </span>
                    </h2>
                    <span className="text-sm font-medium tabular-nums">{formatMoney(subtotal, true)}</span>
                  </div>
                  {cat.monthly_budget != null && cat.kind !== "income" && (
                    <BudgetBar spent={subtotal} budget={cat.monthly_budget} />
                  )}
                </div>
                <ul className="divide-y divide-[var(--color-border)] empty:hidden">
                  {visible.map((item) => (
                    <AmountRow
                      key={`${item.id}|${month}`}
                      item={item}
                      month={month}
                      ledger={ledger}
                      onSaved={(saved) => applyAmount(item.id, month, saved)}
                      onEnter={focusNext}
                      onEditOneOff={(o) => setEditingOneOff({ oneOff: o })}
                      onShowCard={(card) =>
                        setCardDialog({
                          title: `${item.name} · ${formatMonth(month)}`,
                          description: "Card charges included in this line. Move any that belong elsewhere.",
                          ids: new Set(card.map((t) => t.id)),
                        })
                      }
                    />
                  ))}
                </ul>
                {catOneOffs.length + catCard.length > 0 && !onlyMissing && (
                  <div className="border-t border-[var(--color-border)]">
                    <p className="px-4 pt-2 text-xs font-medium text-[var(--color-muted-foreground)]">Entries</p>
                    <OneOffList
                      oneOffs={catOneOffs}
                      categories={categories}
                      items={items}
                      showTarget={false}
                      onEdit={(o) => setEditingOneOff({ oneOff: o })}
                    />
                    {catCard.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setCardDialog({
                            title: `${cat.name} · ${formatMonth(month)}`,
                            description: "Card charges filed to this category without a specific line. Move any that belong elsewhere.",
                            ids: new Set(catCard.map((t) => t.id)),
                          })
                        }
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--color-accent)]"
                      >
                        <CreditCard className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          Amex ({catCard.length} {catCard.length === 1 ? "charge" : "charges"})
                        </span>
                        <span className="font-medium tabular-nums">{formatMoney(sumMoney(catCard.map((t) => t.amount)), true)}</span>
                      </button>
                    )}
                  </div>
                )}
                {!onlyMissing && (
                  <div className={cn("px-2 py-1.5", visible.length + catOneOffs.length + catCard.length > 0 && "border-t border-[var(--color-border)]")}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[var(--color-primary)]"
                      onClick={() => setEditingOneOff({ oneOff: null, category_id: cat.id })}
                    >
                      <Plus /> Add entry to {cat.name}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}

          <Card>
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
              <h2 className="flex items-center gap-2 font-semibold">
                <ShoppingBag className="h-4 w-4" aria-hidden /> All entries this month
              </h2>
              <span className="text-sm font-medium tabular-nums">{formatMoney(summary.oneOffs, true)}</span>
            </div>
            {monthOneOffs.length ? (
              <OneOffList
                oneOffs={monthOneOffs}
                categories={categories}
                items={items}
                onEdit={(o) => setEditingOneOff({ oneOff: o })}
              />
            ) : (
              <p className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
                No entries this month. Add itemized spending like “Hotel $500” to any category.
              </p>
            )}
            <div className="px-2 py-1">
              <Button variant="ghost" size="sm" onClick={() => setEditingOneOff({ oneOff: null })}>
                <Plus /> Add entry
              </Button>
            </div>
          </Card>

          {onlyMissing && enteredCount === activeItems.length && (
            <p className="py-8 text-center text-[var(--color-muted-foreground)]">
              Everything for {formatMonth(month)} is entered.
            </p>
          )}
        </div>
      )}

      {cardDialog && (
        <CardTransactionsDialog
          title={cardDialog.title}
          description={cardDialog.description}
          onClose={() => setCardDialog(null)}
          transactions={transactions.filter((t) => cardDialog.ids.has(t.id))}
          categories={categories}
          items={items}
          oneOffs={oneOffs}
          onSaved={applyTransactions}
          onCreated={applyCreated}
        />
      )}

      {editingOneOff && (
        <OneOffDialog
          oneOff={editingOneOff.oneOff}
          defaults={{ month, category_id: editingOneOff.category_id, line_item_id: editingOneOff.line_item_id }}
          categories={categories}
          items={items}
          onClose={() => setEditingOneOff(null)}
          onSaved={(id, saved) => {
            setEditingOneOff(null);
            applyOneOff(id, saved);
          }}
        />
      )}
    </div>
  );
}

function AmountRow({
  item,
  month,
  ledger,
  onSaved,
  onEnter,
  onEditOneOff,
  onShowCard,
}: {
  item: LineItem;
  month: string;
  ledger: Ledger;
  onSaved: (saved: MonthlyAmount | null) => void;
  onEnter: (input: HTMLInputElement) => void;
  onEditOneOff: (o: OneOff) => void;
  onShowCard: (card: Transaction[]) => void;
}) {
  const idx = ledger.idx;
  const value = idx.get(item.id)?.get(month);
  const note = ledger.notes.get(item.id)?.get(month) ?? "";
  const linked = itemOneOffs(ledger, item.id, month);
  const card = itemCard(ledger, item.id, month);
  const suggestion = value === undefined && !card.length ? suggestedAmount(item, month, idx) : null;
  const saver = useCellSaver(item.id, month, value, onSaved);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState(note);
  const [noteError, setNoteError] = useState<string | null>(null);

  async function commitNote() {
    if (noteText.trim() === note) {
      setNoteOpen(false);
      return;
    }
    try {
      onSaved(await saveNote(item.id, month, noteText));
      setNoteOpen(false);
      setNoteError(null);
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "Could not save note");
    }
  }

  const hint = value !== undefined && value > 0 ? anomalyHint(item, month, value, idx) : null;
  const total = itemMonthTotal(ledger, item.id, month) ?? 0;
  const inputId = `amt-${item.id}`;
  const message = saver.message ?? noteError;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
      <label htmlFor={inputId} className="min-w-0 flex-1">
        <span
          className={cn("block truncate", value === undefined && !card.length && "text-[var(--color-muted-foreground)]")}
        >
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
            onClick={() => saver.commit(String(suggestion))}
            aria-label={`Use ${formatMoney(suggestion, true)} for ${item.name}`}
            title={item.recurrence === "fixed" ? "Use the usual amount" : "Use last month's amount"}
          >
            <Check /> {formatMoney(suggestion)}
          </Button>
        )}
        {value !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("h-9 w-9", !note && "text-[var(--color-muted-foreground)]")}
            onClick={() => {
              setNoteText(note);
              setNoteOpen((o) => !o);
            }}
            aria-label={note ? `Edit note for ${item.name}` : `Add note for ${item.name}`}
            aria-expanded={noteOpen}
            title={note || "Add a note"}
          >
            <MessageSquare className={cn(note && "fill-current")} />
          </Button>
        )}
        <AmountInput id={inputId} value={value} saver={saver} onEnter={onEnter} />
      </div>
      {note && !noteOpen && (
        <p className="w-full text-right text-xs text-[var(--color-muted-foreground)]">“{note}”</p>
      )}
      {noteOpen && (
        <div className="flex w-full justify-end">
          <input
            autoFocus
            aria-label={`Note for ${item.name}`}
            className="h-8 w-full max-w-sm rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            placeholder="e.g. AC ran all month"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onBlur={commitNote}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setNoteText(note);
                setNoteOpen(false);
              }
            }}
          />
        </div>
      )}
      {(linked.length > 0 || card.length > 0) && (
        <div className="w-full space-y-0.5 text-right text-xs text-[var(--color-muted-foreground)]">
          {card.length > 0 && (
            <button type="button" className="inline-flex w-full items-center justify-end gap-1 hover:underline" onClick={() => onShowCard(card)}>
              <CreditCard className="h-3 w-3" aria-hidden />+ {formatMoney(sumMoney(card.map((t) => t.amount)), true)} Amex (
              {card.length} {card.length === 1 ? "charge" : "charges"})
            </button>
          )}
          {linked.map((o) => (
            <button key={o.id} type="button" className="block w-full text-right hover:underline" onClick={() => onEditOneOff(o)}>
              + {formatMoney(o.amount, true)} {o.name}
            </button>
          ))}
          <p className="font-medium text-[var(--color-foreground)]">Total {formatMoney(total, true)}</p>
        </div>
      )}
      {item.monthly_budget != null && (
        <BudgetBar spent={total} budget={item.monthly_budget} className="w-full" />
      )}
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
