import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  CreditCard,
  FolderPlus,
  ListPlus,
  Plus,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-message";
import { BudgetBar } from "@/components/BudgetBar";
import { CardActivity } from "@/components/CardActivity";
import { CardTransactionsDialog } from "@/components/CardTransactions";
import { EmptyBudget } from "@/components/EmptyBudget";
import { OneOffDialog } from "@/components/OneOffDialog";
import { CardChargesRow, OneOffList } from "@/components/OneOffList";
import { RecurringDialog, RecurringPanel } from "@/components/RecurringPanel";
import { CategoryDialog, ItemDialog } from "@/components/StructureDialogs";
import { StepperNav } from "@/components/StepperNav";
import { SummaryTiles } from "@/components/SummaryTiles";
import { useBudget } from "@/hooks/useBudget";
import {
  addMonths,
  categoryCard,
  categoryOneOffs,
  currentMonthKey,
  formatMoney,
  formatMonth,
  itemCard,
  itemMonthTotal,
  itemOneOffs,
  KIND_LABEL,
  monthKeyFromSlug,
  monthSlug,
  saveOrder,
  summarizeMonth,
  sumMoney,
  totalForCategoryMonth,
  type Category,
  type Ledger,
  type LineItem,
  type OneOff,
} from "@/lib/budget";
import type { RecurringEntry } from "@/lib/recurring";
import type { Transaction } from "@/lib/transactions";
import { cn } from "@/lib/utils";

type EditingOneOff = { oneOff: OneOff | null; category_id?: string | null; startRecurring?: boolean } | null;
type Creating = { type: "category" } | { type: "item"; categoryId: string } | null;

const COLLAPSED_KEY = "budgeto-month-collapsed";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function MonthEntry() {
  const params = useParams();
  const navigate = useNavigate();
  const month = monthKeyFromSlug(params.month) ?? currentMonthKey();

  // Load a few months back too, for "vs last month" and recent amounts of varying recurring entries
  const {
    categories,
    items,
    oneOffs,
    transactions,
    ledger,
    loading,
    error,
    reload,
    applyOneOff,
    recurring,
    refresh,
    applyTransactions,
    applyCreated,
    applyCategories,
  } = useBudget(addMonths(month, -3), addMonths(month, 1));
  const [editingOneOff, setEditingOneOff] = useState<EditingOneOff>(null);
  const [creating, setCreating] = useState<Creating>(null);
  const [reordering, setReordering] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  // A recurring entry whose amount changes each month opens in its own modal (this month's amount)
  const [managing, setManaging] = useState<RecurringEntry | null>(null);
  // Which card charges the dialog shows (a snapshot, so a reassigned charge stays in view)
  const [cardDialog, setCardDialog] = useState<{ title: string; description: string; ids: Set<string> } | null>(null);
  // Categories folded down to their header; remembered across months and visits
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    } catch {
      // storage unavailable (private mode); collapsing just won't persist
    }
  }, [collapsed]);

  const toggleCategory = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const activeCategories = categories.filter((c) => !c.archived);
  const activeItems = items.filter((i) => !i.archived && activeCategories.some((c) => c.id === i.category_id));
  const summary = summarizeMonth(ledger, month);
  const prevSummary = summarizeMonth(ledger, addMonths(month, -1));
  const needsCategory = ledger.uncategorized.get(month) ?? [];

  const editEntry = (o: OneOff) => {
    const series = o.recurring_id ? recurring.find((r) => r.id === o.recurring_id) : undefined;
    if (series?.amount_varies) setManaging(series);
    else setEditingOneOff({ oneOff: o });
  };

  const showCard = (title: string, description: string, card: Transaction[]) =>
    setCardDialog({ title, description, ids: new Set(card.map((t) => t.id)) });

  const go = (delta: number) => navigate(`/month/${monthSlug(addMonths(month, delta))}`);
  const allCollapsed = activeCategories.length > 0 && activeCategories.every((c) => collapsed.has(c.id));

  /** Swap a category with its neighbour; shows the new order right away, then saves it. */
  async function moveCategory(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= activeCategories.length) return;
    const reordered = [...activeCategories];
    [reordered[index], reordered[j]] = [reordered[j], reordered[index]];
    // Archived categories keep their place after the active ones
    const ordered = [...reordered, ...categories.filter((c) => c.archived)];
    applyCategories(ordered.map((c, k) => ({ ...c, sort_order: (k + 1) * 10 })));
    setOrderError(null);
    try {
      await saveOrder("categories", ordered);
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : "Couldn't save the new order");
      refresh();
    }
  }

  if (!loading && !error && categories.length === 0) return <EmptyBudget onSeeded={reload} />;

  return (
    <div className="mx-auto max-w-3xl space-y-6 xl:max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StepperNav
          label={formatMonth(month)}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          prevLabel="Previous month"
          nextLabel="Next month"
          picker={{ mode: "month", value: month, onSelect: (m) => navigate(`/month/${monthSlug(m)}`) }}
          onToday={month !== currentMonthKey() ? () => navigate(`/month/${monthSlug(currentMonthKey())}`) : undefined}
          todayLabel="This month"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
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

      {loading ? (
        <p className="text-[var(--color-muted-foreground)]">Loading…</p>
      ) : (
        <>

          <SummaryTiles current={summary} previous={prevSummary} compareLabel="vs last month" />

          {needsCategory.length > 0 && (
            <Card className="border-[var(--color-warning)]">
              <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--color-warning)]" aria-hidden />
                <span>
                  {needsCategory.length === 1 ? "This manual entry needs" : "These manual entries need"} a category.
                  Click to pick one.
                </span>
              </div>
              <OneOffList
                oneOffs={needsCategory}
                categories={categories}
                items={items}
                showTarget={false}
                onEdit={editEntry}
              />
            </Card>
          )}

          {/* Wide screens: categories on the left, recurring and card activity alongside */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start">
            <aside className="space-y-6 xl:col-start-2 xl:row-start-1">
              <RecurringPanel
                month={month}
                recurring={recurring}
                oneOffs={oneOffs}
                categories={categories}
                items={items}
                onAdd={() => setEditingOneOff({ oneOff: null, startRecurring: true })}
                onChanged={refresh}
                onAmountSaved={applyOneOff}
              />

              <CardActivity
                month={month}
                transactions={transactions}
                categories={categories}
                items={items}
                oneOffs={oneOffs}
                onOpenCharges={(title, description, charges) => showCard(title, description, charges)}
              />
            </aside>

            <section className="space-y-4 xl:col-start-1 xl:row-start-1" aria-label="Categories">
              <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
                <h2 className="mr-auto text-sm font-semibold text-[var(--color-muted-foreground)]">Categories</h2>
                {reordering ? (
                  <Button size="sm" onClick={() => setReordering(false)}>
                    <Check /> Done
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[var(--color-primary)]"
                      onClick={() => setCreating({ type: "category" })}
                    >
                      <FolderPlus /> New category
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setReordering(true)}>
                      <ArrowUpDown /> Reorder
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(activeCategories.map((c) => c.id)))}
                    >
                      {allCollapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
                      {allCollapsed ? "Expand all" : "Collapse all"}
                    </Button>
                  </>
                )}
              </div>

              {orderError && <FormError>{orderError}</FormError>}

              {reordering ? (
                <Card>
                  <ol className="divide-y divide-[var(--color-border)]">
                    {activeCategories.map((cat, ci) => (
                      <li key={cat.id} className="flex items-center gap-2 py-1.5 pr-2 pl-4">
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {cat.name}
                          <span className="ml-2 text-xs font-normal text-[var(--color-muted-foreground)]">{KIND_LABEL[cat.kind]}</span>
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Move ${cat.name} up`}
                          disabled={ci === 0}
                          onClick={() => moveCategory(ci, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Move ${cat.name} down`}
                          disabled={ci === activeCategories.length - 1}
                          onClick={() => moveCategory(ci, 1)}
                        >
                          <ArrowDown />
                        </Button>
                      </li>
                    ))}
                  </ol>
                </Card>
              ) : (
                activeCategories.map((cat) => (
                  <CategoryCard
                    key={cat.id}
                    category={cat}
                    lineItems={activeItems.filter((i) => i.category_id === cat.id)}
                    month={month}
                    ledger={ledger}
                    collapsed={collapsed.has(cat.id)}
                    onToggle={() => toggleCategory(cat.id)}
                    onAdd={() => setEditingOneOff({ oneOff: null, category_id: cat.id })}
                    onAddItem={() => setCreating({ type: "item", categoryId: cat.id })}
                    onEdit={editEntry}
                    onShowCard={showCard}
                  />
                ))
              )}
            </section>
          </div>
        </>
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

      {creating?.type === "category" && (
        <CategoryDialog
          category={null}
          nextSortOrder={(categories.length + 1) * 10}
          onClose={() => setCreating(null)}
          onSaved={() => {
            setCreating(null);
            refresh();
          }}
        />
      )}
      {creating?.type === "item" && (
        <ItemDialog
          item={null}
          categoryId={creating.categoryId}
          categories={activeCategories}
          nextSortOrder={(items.filter((i) => i.category_id === creating.categoryId).length + 1) * 10}
          onClose={() => setCreating(null)}
          onSaved={() => {
            setCreating(null);
            refresh();
          }}
        />
      )}

      {managing && (
        <RecurringDialog
          entry={managing}
          month={month}
          oneOffs={oneOffs}
          categories={categories}
          items={items}
          onClose={() => setManaging(null)}
          onChanged={() => {
            setManaging(null);
            refresh();
          }}
          onAmountSaved={(id, saved) => {
            setManaging(null);
            applyOneOff(id, saved);
          }}
        />
      )}

      {editingOneOff && (
        <OneOffDialog
          oneOff={editingOneOff.oneOff}
          defaults={{ month, category_id: editingOneOff.category_id }}
          categories={categories}
          items={items}
          recurring={recurring}
          startRecurring={editingOneOff.startRecurring}
          onClose={() => setEditingOneOff(null)}
          onRecurringChanged={() => {
            setEditingOneOff(null);
            refresh();
          }}
          onSaved={(id, saved) => {
            setEditingOneOff(null);
            applyOneOff(id, saved);
          }}
        />
      )}
    </div>
  );
}

/** A category for one month: its line items, its "Other" row, and the button to add a manual entry. Collapses to its header. */
function CategoryCard({
  category,
  lineItems,
  month,
  ledger,
  collapsed,
  onToggle,
  onAdd,
  onAddItem,
  onEdit,
  onShowCard,
}: {
  category: Category;
  lineItems: LineItem[];
  month: string;
  ledger: Ledger;
  collapsed: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onAddItem: () => void;
  onEdit: (o: OneOff) => void;
  onShowCard: (title: string, description: string, card: Transaction[]) => void;
}) {
  const otherEntries = categoryOneOffs(ledger, category.id, month);
  const otherCard = categoryCard(ledger, category.id, month);
  const hasOther = otherEntries.length + otherCard.length > 0;
  const subtotal = totalForCategoryMonth(ledger, category.id, month);
  const otherTotal = sumMoney([...otherEntries, ...otherCard].map((x) => x.amount));
  const bodyId = `category-${category.id}`;

  return (
    <Card>
      <div className={cn("space-y-2 px-4 py-3", !collapsed && "border-b border-[var(--color-border)]")}>
        <h2>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            className="-mx-1 flex w-[calc(100%+0.5rem)] items-baseline gap-2 rounded-md px-1 text-left focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]"
          >
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 self-center text-[var(--color-muted-foreground)] transition-transform", collapsed && "-rotate-90")}
              aria-hidden
            />
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
              <span className="min-w-0 truncate font-semibold">{category.name}</span>
              <span className="text-xs whitespace-nowrap text-[var(--color-muted-foreground)]">{KIND_LABEL[category.kind]}</span>
            </span>
            <span className="text-sm font-medium tabular-nums">{formatMoney(subtotal, true)}</span>
          </button>
        </h2>
        {category.monthly_budget != null && category.kind !== "income" && (
          <BudgetBar spent={subtotal} budget={category.monthly_budget} />
        )}
      </div>
      {!collapsed && (
        <div id={bodyId}>
          <ul className="divide-y divide-[var(--color-border)] empty:hidden">
            {lineItems.map((item) => (
              <ItemSection
                key={item.id}
                label={item.name}
                total={itemMonthTotal(ledger, item.id, month)}
                budget={item.monthly_budget}
                entries={itemOneOffs(ledger, item.id, month)}
                card={itemCard(ledger, item.id, month)}
                onEdit={onEdit}
                onShowCard={(card) =>
                  onShowCard(`${item.name} · ${formatMonth(month)}`, "Card charges in this line. Move any that belong elsewhere.", card)
                }
              />
            ))}
            {hasOther && (
              <ItemSection
                label="Other"
                muted
                total={otherTotal}
                entries={otherEntries}
                card={otherCard}
                onEdit={onEdit}
                onShowCard={(card) =>
                  onShowCard(
                    `${category.name} · Other · ${formatMonth(month)}`,
                    "Card charges filed to this category without a specific line. Move any that belong elsewhere.",
                    card
                  )
                }
              />
            )}
          </ul>
          <div
            className={cn(
              "flex flex-wrap gap-x-1 px-2 py-1.5",
              lineItems.length + (hasOther ? 1 : 0) > 0 && "border-t border-[var(--color-border)]"
            )}
          >
            <Button variant="ghost" size="sm" className="text-[var(--color-primary)]" onClick={onAdd}>
              <Plus /> Add manual entry
            </Button>
            <Button variant="ghost" size="sm" className="text-[var(--color-muted-foreground)]" onClick={onAddItem}>
              <ListPlus /> Add line item
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** A line item (or the category's "Other" row): its total, then the manual entries and card charges that make it up. */
function ItemSection({
  label,
  muted = false,
  total,
  budget,
  entries,
  card,
  onEdit,
  onShowCard,
}: {
  label: string;
  muted?: boolean;
  total: number | undefined;
  budget?: number | null;
  entries: OneOff[];
  card: Transaction[];
  onEdit: (o: OneOff) => void;
  onShowCard: (card: Transaction[]) => void;
}) {
  return (
    <li>
      <div className="flex items-center gap-3 px-4 pt-2.5 pb-2">
        <span className={cn("min-w-0 flex-1 truncate", muted && "italic", total === undefined && "text-[var(--color-muted-foreground)]")}>
          {label}
        </span>
        <span className={cn("tabular-nums", total === undefined ? "text-[var(--color-muted-foreground)]" : "font-medium")}>
          {total === undefined ? "—" : formatMoney(total, true)}
        </span>
      </div>
      {budget != null && <BudgetBar spent={total ?? 0} budget={budget} className="px-4 pb-2" />}
      {(entries.length > 0 || card.length > 0) && (
        <div className="pb-1.5 pl-4 [&_button]:pl-3">
          {card.length > 0 && <CardChargesRow charges={card} onClick={() => onShowCard(card)} />}
          <OneOffList oneOffs={entries} categories={[]} items={[]} showTarget={false} onEdit={onEdit} className="divide-y-0" />
        </div>
      )}
    </li>
  );
}
