import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, CreditCard, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-message";
import { BudgetBar } from "@/components/BudgetBar";
import { CardActivity } from "@/components/CardActivity";
import { CardTransactionsDialog } from "@/components/CardTransactions";
import { EmptyBudget } from "@/components/EmptyBudget";
import { OneOffDialog } from "@/components/OneOffDialog";
import { CardChargesRow, OneOffList } from "@/components/OneOffList";
import { RecurringPanel } from "@/components/RecurringPanel";
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
  itemEntered,
  itemMonthTotal,
  itemOneOffs,
  KIND_LABEL,
  monthKeyFromSlug,
  monthSlug,
  summarizeMonth,
  sumMoney,
  totalForCategoryMonth,
  type Category,
  type Ledger,
  type LineItem,
  type OneOff,
} from "@/lib/budget";
import type { Transaction } from "@/lib/transactions";
import { cn } from "@/lib/utils";

type EditingOneOff = { oneOff: OneOff | null; category_id?: string | null; startRecurring?: boolean } | null;

export function MonthEntry() {
  const params = useParams();
  const navigate = useNavigate();
  const month = monthKeyFromSlug(params.month) ?? currentMonthKey();

  // Load last month too, for "vs last month"
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
  } = useBudget(addMonths(month, -1), addMonths(month, 1));
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [editingOneOff, setEditingOneOff] = useState<EditingOneOff>(null);
  // Which card charges the dialog shows (a snapshot, so a reassigned charge stays in view)
  const [cardDialog, setCardDialog] = useState<{ title: string; description: string; ids: Set<string> } | null>(null);

  const activeCategories = categories.filter((c) => !c.archived);
  const activeItems = items.filter((i) => !i.archived && activeCategories.some((c) => c.id === i.category_id));
  const summary = summarizeMonth(ledger, month);
  const prevSummary = summarizeMonth(ledger, addMonths(month, -1));
  const needsCategory = ledger.uncategorized.get(month) ?? [];

  const showCard = (title: string, description: string, card: Transaction[]) =>
    setCardDialog({ title, description, ids: new Set(card.map((t) => t.id)) });

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

      {!loading && (
        <>
          <SummaryTiles current={summary} previous={prevSummary} compareLabel="vs last month" />

          <Card>
            <CardContent className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-48 flex-1">
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium">
                    {enteredCount} of {activeItems.length} line items have something
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
                Only show empty
              </label>
            </CardContent>
          </Card>

          <RecurringPanel
            month={month}
            recurring={recurring}
            oneOffs={oneOffs}
            categories={categories}
            items={items}
            onAdd={() => setEditingOneOff({ oneOff: null, startRecurring: true })}
            onChanged={refresh}
          />

          <CardActivity
            month={month}
            transactions={transactions}
            categories={categories}
            items={items}
            oneOffs={oneOffs}
            onOpenCharges={(title, description, charges) => showCard(title, description, charges)}
          />

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
                onEdit={(o) => setEditingOneOff({ oneOff: o })}
              />
            </Card>
          )}
        </>
      )}

      {loading ? (
        <p className="text-[var(--color-muted-foreground)]">Loading…</p>
      ) : (
        <div className="space-y-4">
          {activeCategories.map((cat) => {
            const catItems = activeItems.filter((i) => i.category_id === cat.id);
            const visible = onlyMissing ? catItems.filter((i) => !itemEntered(ledger, i.id, month)) : catItems;
            if (onlyMissing && !visible.length) return null;
            return (
              <CategoryCard
                key={cat.id}
                category={cat}
                lineItems={visible}
                month={month}
                ledger={ledger}
                showOther={!onlyMissing}
                onAdd={() => setEditingOneOff({ oneOff: null, category_id: cat.id })}
                onEdit={(o) => setEditingOneOff({ oneOff: o })}
                onShowCard={showCard}
              />
            );
          })}

          {onlyMissing && enteredCount === activeItems.length && (
            <p className="py-8 text-center text-[var(--color-muted-foreground)]">
              Every line item has something for {formatMonth(month)}.
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

/** A category for one month: its line items, its "Other" row, and the button to add a manual entry. */
function CategoryCard({
  category,
  lineItems,
  month,
  ledger,
  showOther,
  onAdd,
  onEdit,
  onShowCard,
}: {
  category: Category;
  lineItems: LineItem[];
  month: string;
  ledger: Ledger;
  showOther: boolean;
  onAdd: () => void;
  onEdit: (o: OneOff) => void;
  onShowCard: (title: string, description: string, card: Transaction[]) => void;
}) {
  const otherEntries = categoryOneOffs(ledger, category.id, month);
  const otherCard = categoryCard(ledger, category.id, month);
  const hasOther = showOther && otherEntries.length + otherCard.length > 0;
  const subtotal = totalForCategoryMonth(ledger, category.id, month);
  const otherTotal = sumMoney([...otherEntries, ...otherCard].map((x) => x.amount));

  return (
    <Card>
      <div className="space-y-2 border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">
            {category.name}
            <span className="ml-2 text-xs font-normal text-[var(--color-muted-foreground)]">{KIND_LABEL[category.kind]}</span>
          </h2>
          <span className="text-sm font-medium tabular-nums">{formatMoney(subtotal, true)}</span>
        </div>
        {category.monthly_budget != null && category.kind !== "income" && (
          <BudgetBar spent={subtotal} budget={category.monthly_budget} />
        )}
      </div>
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
      {showOther && (
        <div className={cn("px-2 py-1.5", lineItems.length + (hasOther ? 1 : 0) > 0 && "border-t border-[var(--color-border)]")}>
          <Button variant="ghost" size="sm" className="text-[var(--color-primary)]" onClick={onAdd}>
            <Plus /> Add manual entry
          </Button>
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
