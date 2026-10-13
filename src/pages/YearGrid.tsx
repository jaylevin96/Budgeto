import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ChevronDown, ChevronRight, Download, MessageSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-message";
import { Label } from "@/components/ui/label";
import { AmountInput } from "@/components/AmountInput";
import { useCellSaver } from "@/hooks/useCellSaver";
import { EmptyBudget } from "@/components/EmptyBudget";
import { CardTransactionList } from "@/components/CardTransactions";
import { OneOffDialog } from "@/components/OneOffDialog";
import { OneOffList } from "@/components/OneOffList";
import { StepperNav } from "@/components/StepperNav";
import { useBudget } from "@/hooks/useBudget";
import { useChartColors } from "@/lib/chartColors";
import {
  categoryHasData,
  categoryOneOffs,
  currentMonthKey,
  formatMoney,
  formatMonth,
  hasUncategorized as monthHasUncategorized,
  itemCard,
  itemMonthTotal,
  itemOneOffs,
  KIND_LABEL,
  monthKey,
  monthSlug,
  MONTH_SHORT,
  parseMonthKey,
  saveNote,
  summarizeMonth,
  sumMoney,
  totalForCategoryMonth,
  uncategorizedCard,
  uncategorizedTotal,
  type Category,
  type Ledger,
  type LineItem,
  type MonthlyAmount,
  type OneOff,
} from "@/lib/budget";
import type { Transaction } from "@/lib/transactions";
import { cn } from "@/lib/utils";

const cellClass = "px-1 py-1 text-right tabular-nums whitespace-nowrap";
const stickyName = "sticky left-0 z-10 px-3 py-1.5 text-left whitespace-nowrap max-w-44 truncate";
const UNCATEGORIZED = "uncategorized";
const STORAGE_KEY = "budgeto-year-expanded";

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

type CellTarget =
  | { kind: "item"; item: LineItem; month: string }
  | { kind: "category"; category: Category; month: string }
  | { kind: "uncategorized"; month: string };

type EditingOneOff = { oneOff: OneOff | null; month: string; category_id?: string | null; line_item_id?: string | null };

/** The spreadsheet view: categories collapse to totals, expand to editable line items and one-offs. */
export function YearGrid() {
  const params = useParams();
  const navigate = useNavigate();
  const colors = useChartColors();
  const year = /^\d{4}$/.test(params.year ?? "") ? Number(params.year) : parseMonthKey(currentMonthKey()).year;
  const months = Array.from({ length: 12 }, (_, m) => monthKey(year, m));

  const { categories, items, oneOffs, ledger, loading, error, reload, applyAmount, applyOneOff, applyTransactions } = useBudget(
    monthKey(year, 0),
    monthKey(year + 1, 0)
  );
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [cell, setCell] = useState<CellTarget | null>(null);
  const [editingOneOff, setEditingOneOff] = useState<EditingOneOff | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...expanded]));
    } catch {
      // storage unavailable (private mode); expansion just won't persist
    }
  }, [expanded]);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Enter moves down the same month column, like a spreadsheet; Tab moves right natively
  const tableRef = useRef<HTMLTableElement>(null);
  const focusBelow = useCallback((from: HTMLInputElement) => {
    const col = from.dataset.col;
    const inputs = Array.from(tableRef.current?.querySelectorAll<HTMLInputElement>(`input[data-col="${col}"]`) ?? []);
    const next = inputs[inputs.indexOf(from) + 1];
    if (next) {
      next.focus();
      next.select();
    } else {
      from.blur();
    }
  }, []);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const { exportYear } = await import("@/lib/exporter");
      await exportYear(year, ledger);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  if (!loading && !error && categories.length === 0) return <EmptyBudget onSeeded={reload} />;

  const summaries = months.map((m) => summarizeMonth(ledger, m));
  const visibleCats = categories.filter((c) => !c.archived || months.some((m) => categoryHasData(ledger, c.id, m)));
  const uncatTotals = months.map((m) => uncategorizedTotal(ledger, m));
  const hasUncategorized = months.some((m) => monthHasUncategorized(ledger, m));
  const hasUnfiledCard = months.some((m) => uncategorizedCard(ledger, m).length > 0);
  const allGroups = [...visibleCats.map((c) => c.id), ...(hasUncategorized ? [UNCATEGORIZED] : [])];

  const totalRows: { label: string; values: number[]; strong?: boolean }[] = [
    { label: "Total income", values: summaries.map((s) => s.income) },
    { label: "Total spending", values: summaries.map((s) => s.spending) },
    { label: "Total saved", values: summaries.map((s) => s.savings) },
    { label: "Left over", values: summaries.map((s) => s.net), strong: true },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StepperNav
          label={String(year)}
          onPrev={() => navigate(`/year/${year - 1}`)}
          onNext={() => navigate(`/year/${year + 1}`)}
          prevLabel="Previous year"
          nextLabel="Next year"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set(allGroups))}>
            Expand all
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set())}>
            Collapse all
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditingOneOff({ oneOff: null, month: lastMonthWithData(summaries) ?? months[0] })}
          >
            <Plus /> One-off
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || loading}>
            <Download /> {exporting ? "Exporting…" : "Export .xlsx"}
          </Button>
        </div>
      </div>
      {(error || exportError) && <FormError>{error ?? exportError}</FormError>}
      <p className="text-xs text-[var(--color-muted-foreground)]">
        Click a category to see its line items. Line-item cells are editable: Enter moves down, Tab moves right.
        Cells marked <span className="rounded bg-[var(--color-muted)] px-1">+1</span> include one-off purchases; click
        them to see details.
      </p>
      {loading ? (
        <p className="text-[var(--color-muted-foreground)]">Loading…</p>
      ) : (
        <Card className="overflow-x-auto">
          <table ref={tableRef} className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-muted-foreground)]">
                <th className={cn(stickyName, "bg-[var(--color-card)] font-medium")}>Category / item</th>
                {months.map((m, i) => (
                  <th key={m} className={cn(cellClass, "font-medium")}>
                    <Link to={`/month/${monthSlug(m)}`} className="hover:underline">
                      {MONTH_SHORT[i]}
                    </Link>
                  </th>
                ))}
                <th className={cn(cellClass, "font-semibold text-[var(--color-foreground)]")}>Year</th>
                <th className={cn(cellClass, "font-medium")}>Avg/mo</th>
                <th className={cn(cellClass, "font-medium")}>Budget</th>
                <th className="px-3 py-1.5 text-left font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              {visibleCats.map((cat) => {
                const isOpen = expanded.has(cat.id);
                const catItems = items.filter((i) => i.category_id === cat.id);
                const totals = months.map((m) => totalForCategoryMonth(ledger, cat.id, m));
                const has = months.map((m) => categoryHasData(ledger, cat.id, m));
                const oneOffTotals = months.map((m) => sumMoney(categoryOneOffs(ledger, cat.id, m).map((o) => o.amount)));
                const hasCatOneOffs = months.some((m) => categoryOneOffs(ledger, cat.id, m).length > 0);
                return (
                  <Fragment key={cat.id}>
                    <SummaryRow
                      label={
                        <button
                          type="button"
                          onClick={() => toggle(cat.id)}
                          aria-expanded={isOpen}
                          className="flex w-full items-center gap-1 text-left"
                        >
                          {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                          <span className="truncate font-semibold" title={`${cat.name} (${KIND_LABEL[cat.kind]})`}>
                            {cat.name}
                          </span>
                        </button>
                      }
                      values={totals}
                      has={has}
                      budget={cat.kind !== "income" ? cat.monthly_budget : null}
                      color={colors.categorical[0]}
                      rowClass="bg-[var(--color-muted)] font-medium"
                      nameBg="bg-[var(--color-muted)]"
                    />
                    {isOpen &&
                      catItems.map((item) => (
                        <ItemRow
                          key={item.id}
                          item={item}
                          months={months}
                          ledger={ledger}
                          color={colors.categorical[0]}
                          onSaved={(month, saved) => applyAmount(item.id, month, saved)}
                          onEnter={focusBelow}
                          onOpenCell={(month) => setCell({ kind: "item", item, month })}
                        />
                      ))}
                    {isOpen && hasCatOneOffs && (
                      <SummaryRow
                        label={<span className="pl-5 italic">One-offs</span>}
                        values={oneOffTotals}
                        has={months.map((m) => categoryOneOffs(ledger, cat.id, m).length > 0)}
                        color={colors.categorical[0]}
                        rowClass="border-b border-[var(--color-border)]"
                        nameBg="bg-[var(--color-card)]"
                        onCellClick={(i) => setCell({ kind: "category", category: cat, month: months[i] })}
                      />
                    )}
                  </Fragment>
                );
              })}
              {hasUncategorized && (
                <SummaryRow
                  label={
                    <button
                      type="button"
                      onClick={() => toggle(UNCATEGORIZED)}
                      aria-expanded={expanded.has(UNCATEGORIZED)}
                      className="flex w-full items-center gap-1 text-left"
                    >
                      {expanded.has(UNCATEGORIZED) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <span className="truncate font-semibold">Uncategorized</span>
                    </button>
                  }
                  values={uncatTotals}
                  has={months.map((m) => monthHasUncategorized(ledger, m))}
                  color={colors.categorical[0]}
                  rowClass="bg-[var(--color-muted)] font-medium"
                  nameBg="bg-[var(--color-muted)]"
                  onCellClick={(i) => setCell({ kind: "uncategorized", month: months[i] })}
                />
              )}
              {hasUnfiledCard && expanded.has(UNCATEGORIZED) && (
                <tr className="border-b border-[var(--color-border)] hover:bg-[var(--color-accent)]">
                  <td className={cn(stickyName, "bg-[var(--color-card)] pl-8")}>Unfiled card charges</td>
                  {months.map((m) => {
                    const list = uncategorizedCard(ledger, m);
                    return (
                      <td key={m} className={cellClass}>
                        {list.length ? (
                          <button
                            type="button"
                            className="hover:underline"
                            onClick={() => setCell({ kind: "uncategorized", month: m })}
                            title={`${list.length} unfiled ${list.length === 1 ? "charge" : "charges"}`}
                          >
                            {formatMoney(sumMoney(list.map((t) => t.amount)))}
                          </button>
                        ) : (
                          <span className="text-[var(--color-muted-foreground)]">·</span>
                        )}
                      </td>
                    );
                  })}
                  <td className={cn(cellClass, "font-medium")}>
                    {formatMoney(sumMoney(months.flatMap((m) => uncategorizedCard(ledger, m)).map((t) => t.amount)))}
                  </td>
                  <td colSpan={3} />
                </tr>
              )}
              {hasUncategorized &&
                expanded.has(UNCATEGORIZED) &&
                oneOffs
                  .filter((o) => ledger.uncategorized.get(o.month)?.includes(o))
                  .map((o) => (
                    <tr key={o.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-accent)]">
                      <td className={cn(stickyName, "bg-[var(--color-card)] pl-8")}>
                        <button type="button" className="hover:underline" onClick={() => setEditingOneOff({ oneOff: o, month: o.month })}>
                          {o.name}
                        </button>
                      </td>
                      {months.map((m) => (
                        <td key={m} className={cellClass}>
                          {o.month === m ? formatMoney(o.amount) : <span className="text-[var(--color-muted-foreground)]">·</span>}
                        </td>
                      ))}
                      <td className={cn(cellClass, "font-medium")}>{formatMoney(o.amount)}</td>
                      <td colSpan={3} />
                    </tr>
                  ))}
              <tr>
                <th
                  colSpan={17}
                  className="sticky left-0 bg-[var(--color-card)] px-3 pb-1 pt-4 text-left text-xs font-semibold uppercase tracking-wide"
                >
                  Totals
                </th>
              </tr>
              {totalRows.map((row) => (
                <SummaryRow
                  key={row.label}
                  label={<span className={cn(row.strong && "font-semibold")}>{row.label}</span>}
                  values={row.values}
                  has={summaries.map((s) => s.hasData)}
                  color={colors.categorical[0]}
                  rowClass={cn("border-b border-[var(--color-border)]", row.strong && "font-semibold")}
                  nameBg="bg-[var(--color-card)]"
                  negativeRed={row.strong}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {cell && (
        <CellDialog
          target={cell}
          ledger={ledger}
          onClose={() => setCell(null)}
          onSaved={(itemId, month, saved) => applyAmount(itemId, month, saved)}
          onEditOneOff={(o) => setEditingOneOff({ oneOff: o, month: o.month })}
          onAddOneOff={(defaults) => setEditingOneOff({ oneOff: null, ...defaults })}
          onTransactionsSaved={applyTransactions}
        />
      )}
      {editingOneOff && (
        <OneOffDialog
          oneOff={editingOneOff.oneOff}
          defaults={editingOneOff}
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

function lastMonthWithData(summaries: { month: string; hasData: boolean }[]): string | null {
  return [...summaries].reverse().find((s) => s.hasData)?.month ?? null;
}

/** Read-only row of month totals (category totals, one-off sums, grand totals). */
function SummaryRow({
  label,
  values,
  has,
  budget,
  color,
  rowClass,
  nameBg,
  negativeRed,
  onCellClick,
}: {
  label: React.ReactNode;
  values: number[];
  has: boolean[];
  budget?: number | null;
  color: string;
  rowClass?: string;
  nameBg: string;
  negativeRed?: boolean;
  onCellClick?: (monthIdx: number) => void;
}) {
  const filled = values.filter((_, i) => has[i]);
  const year = sumMoney(values);
  return (
    <tr className={rowClass}>
      <td className={cn(stickyName, nameBg)}>{label}</td>
      {values.map((v, i) => {
        const over = budget != null && has[i] && v > budget;
        const content = has[i] ? (
          <span className="inline-flex items-center gap-0.5">
            {over && <AlertTriangle className="h-3 w-3" aria-label="over budget" />}
            {formatMoney(v)}
          </span>
        ) : (
          <span className="text-[var(--color-muted-foreground)]">·</span>
        );
        return (
          <td
            key={i}
            className={cn(
              cellClass,
              "py-1.5",
              over && "text-[var(--color-destructive)]",
              negativeRed && v < 0 && "text-[var(--color-destructive)]"
            )}
            title={over ? `Over the ${formatMoney(budget!)} budget by ${formatMoney(v - budget!)}` : undefined}
          >
            {onCellClick && has[i] ? (
              <button type="button" className="hover:underline" onClick={() => onCellClick(i)}>
                {content}
              </button>
            ) : (
              content
            )}
          </td>
        );
      })}
      <td className={cn(cellClass, "py-1.5 font-semibold")}>{formatMoney(year)}</td>
      <td className={cn(cellClass, "py-1.5 font-normal text-[var(--color-muted-foreground)]")}>
        {filled.length ? formatMoney(sumMoney(filled) / filled.length) : "·"}
      </td>
      <td className={cn(cellClass, "py-1.5 font-normal text-[var(--color-muted-foreground)]")}>
        {budget != null ? formatMoney(budget) : ""}
      </td>
      <td className="px-3 py-1.5">
        <Sparkline values={values.map((v, i) => (has[i] ? v : undefined))} color={color} />
      </td>
    </tr>
  );
}

/** Editable line-item row. Cells with linked one-offs or notes open the cell dialog. */
function ItemRow({
  item,
  months,
  ledger,
  color,
  onSaved,
  onEnter,
  onOpenCell,
}: {
  item: LineItem;
  months: string[];
  ledger: Ledger;
  color: string;
  onSaved: (month: string, saved: MonthlyAmount | null) => void;
  onEnter: (input: HTMLInputElement) => void;
  onOpenCell: (month: string) => void;
}) {
  const totals = months.map((m) => itemMonthTotal(ledger, item.id, m));
  const filled = totals.filter((v): v is number => v !== undefined);
  return (
    <tr className="border-b border-[var(--color-border)] hover:bg-[var(--color-accent)]">
      <td className={cn(stickyName, "bg-[var(--color-card)] pl-8", item.archived && "text-[var(--color-muted-foreground)]")}>
        {item.name}
      </td>
      {months.map((m, i) => (
        <td key={m} className="px-0.5 py-0.5 text-right">
          <ItemCell
            item={item}
            month={m}
            col={i}
            ledger={ledger}
            budget={item.monthly_budget}
            onSaved={(saved) => onSaved(m, saved)}
            onEnter={onEnter}
            onOpen={() => onOpenCell(m)}
          />
        </td>
      ))}
      <td className={cn(cellClass, "font-medium")}>{formatMoney(sumMoney(filled))}</td>
      <td className={cn(cellClass, "text-[var(--color-muted-foreground)]")}>
        {filled.length ? formatMoney(sumMoney(filled) / filled.length) : "·"}
      </td>
      <td className={cn(cellClass, "text-[var(--color-muted-foreground)]")}>
        {item.monthly_budget != null ? formatMoney(item.monthly_budget) : ""}
      </td>
      <td className="px-3 py-1.5">
        <Sparkline values={totals} color={color} />
      </td>
    </tr>
  );
}

function ItemCell({
  item,
  month,
  col,
  ledger,
  budget,
  onSaved,
  onEnter,
  onOpen,
}: {
  item: LineItem;
  month: string;
  col: number;
  ledger: Ledger;
  budget: number | null;
  onSaved: (saved: MonthlyAmount | null) => void;
  onEnter: (input: HTMLInputElement) => void;
  onOpen: () => void;
}) {
  const value = ledger.idx.get(item.id)?.get(month);
  const linked = itemOneOffs(ledger, item.id, month);
  const card = itemCard(ledger, item.id, month);
  const note = ledger.notes.get(item.id)?.get(month);
  const saver = useCellSaver(item.id, month, value, onSaved);
  const total = itemMonthTotal(ledger, item.id, month);
  const over = budget != null && total !== undefined && total > budget;
  const extras = linked.length + card.length;

  if (extras) {
    // Combined value (typed + one-offs + card): edit through the dialog so the sum stays clear
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-md px-1.5 tabular-nums hover:bg-[var(--color-muted)]",
          over && "text-[var(--color-destructive)]"
        )}
        aria-label={`${item.name} ${formatMonth(month, "short")}: ${formatMoney(total ?? 0)} including ${[
          linked.length && `${linked.length} one-off${linked.length > 1 ? "s" : ""}`,
          card.length && `${card.length} card charge${card.length > 1 ? "s" : ""}`,
        ]
          .filter(Boolean)
          .join(" and ")}`}
        title={[
          ...linked.map((o) => `${o.name}: ${formatMoney(o.amount, true)}`),
          ...card.map((t) => `${t.merchant}: ${formatMoney(t.amount, true)}`),
        ].join("\n")}
      >
        {formatMoney(total ?? 0)}
        <span className="rounded bg-[var(--color-muted)] px-1 text-[10px] font-medium text-[var(--color-foreground)]">
          +{extras}
        </span>
      </button>
    );
  }

  return (
    <div className={cn("inline-flex items-center", over && "[&_input]:text-[var(--color-destructive)]")}>
      {note && (
        <button
          type="button"
          onClick={onOpen}
          className="mr-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          aria-label={`Note: ${note}`}
          title={note}
        >
          <MessageSquare className="h-3 w-3 fill-current" />
        </button>
      )}
      <AmountInput
        compact
        value={value}
        saver={saver}
        onEnter={onEnter}
        ariaLabel={`${item.name}, ${formatMonth(month)}`}
        dataAttrs={{ col }}
      />
    </div>
  );
}

/** Details for one cell: base amount, note and one-offs (or a category's / uncategorized one-offs). */
function CellDialog({
  target,
  ledger,
  onClose,
  onSaved,
  onEditOneOff,
  onAddOneOff,
  onTransactionsSaved,
}: {
  target: CellTarget;
  ledger: Ledger;
  onClose: () => void;
  onSaved: (itemId: string, month: string, saved: MonthlyAmount | null) => void;
  onEditOneOff: (o: OneOff) => void;
  onAddOneOff: (defaults: { month: string; category_id?: string | null; line_item_id?: string | null }) => void;
  onTransactionsSaved: (saved: Transaction[]) => void;
}) {
  const { month } = target;
  // Snapshot of which card charges to show, so a reassigned charge stays in view
  const [cardIds] = useState(
    () =>
      new Set(
        (target.kind === "item"
          ? itemCard(ledger, target.item.id, month)
          : target.kind === "uncategorized"
            ? uncategorizedCard(ledger, month)
            : []
        ).map((t) => t.id)
      )
  );
  const cardList = ledger.transactions.filter((t) => cardIds.has(t.id));
  const list =
    target.kind === "item"
      ? itemOneOffs(ledger, target.item.id, month)
      : target.kind === "category"
        ? categoryOneOffs(ledger, target.category.id, month)
        : (ledger.uncategorized.get(month) ?? []);
  const title =
    target.kind === "item"
      ? `${target.item.name} · ${formatMonth(month)}`
      : target.kind === "category"
        ? `${target.category.name} one-offs · ${formatMonth(month)}`
        : `Uncategorized · ${formatMonth(month)}`;
  const addDefaults =
    target.kind === "item"
      ? { month, category_id: target.item.category_id, line_item_id: target.item.id }
      : target.kind === "category"
        ? { month, category_id: target.category.id }
        : { month };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(cardList.length > 0 && "max-w-2xl")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {target.kind === "item" && (
            <DialogDescription>
              Total {formatMoney(itemMonthTotal(ledger, target.item.id, month) ?? 0, true)} = typed amount + one-offs
              {cardList.length > 0 && " + card charges"}
            </DialogDescription>
          )}
        </DialogHeader>
        {target.kind === "item" && (
          <ItemCellEditor item={target.item} month={month} ledger={ledger} onSaved={(s) => onSaved(target.item.id, month, s)} />
        )}
        {cardList.length > 0 && (
          <div className="-mx-4 rounded-md border border-[var(--color-border)] px-4 pt-2 sm:mx-0">
            <p className="text-xs font-medium text-[var(--color-muted-foreground)]">Card charges</p>
            <CardTransactionList
              transactions={cardList}
              categories={ledger.categories}
              items={ledger.items}
              oneOffs={ledger.oneOffs}
              onSaved={onTransactionsSaved}
            />
          </div>
        )}
        <div className="-mx-4 rounded-md border border-[var(--color-border)] sm:mx-0">
          <p className="px-4 pt-2 text-xs font-medium text-[var(--color-muted-foreground)]">One-offs</p>
          {list.length ? (
            <OneOffList
              oneOffs={list}
              categories={ledger.categories}
              items={ledger.items}
              showTarget={false}
              onEdit={(o) => {
                onClose();
                onEditOneOff(o);
              }}
            />
          ) : (
            <p className="px-4 py-2 text-sm text-[var(--color-muted-foreground)]">None this month.</p>
          )}
          <div className="px-2 py-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onClose();
                onAddOneOff(addDefaults);
              }}
            >
              <Plus /> Add one-off
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ItemCellEditor({
  item,
  month,
  ledger,
  onSaved,
}: {
  item: LineItem;
  month: string;
  ledger: Ledger;
  onSaved: (saved: MonthlyAmount | null) => void;
}) {
  const value = ledger.idx.get(item.id)?.get(month);
  const note = ledger.notes.get(item.id)?.get(month) ?? "";
  const saver = useCellSaver(item.id, month, value, onSaved);
  const [noteText, setNoteText] = useState(note);
  const [noteError, setNoteError] = useState<string | null>(null);

  async function commitNote() {
    if (noteText.trim() === note) return;
    try {
      onSaved(await saveNote(item.id, month, noteText));
      setNoteError(null);
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "Could not save note");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="cell-amount">Typed amount</Label>
        <AmountInput id="cell-amount" value={value} saver={saver} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cell-note">Note</Label>
        <input
          id="cell-note"
          disabled={value === undefined}
          className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:opacity-50"
          placeholder={value === undefined ? "Enter an amount first" : "e.g. AC ran all month"}
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onBlur={commitNote}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </div>
      <FormError>{saver.message ?? noteError}</FormError>
    </div>
  );
}

/** Tiny trend line like the spreadsheet's SPARKLINE column. Gaps are skipped. */
function Sparkline({ values, color }: { values: (number | undefined)[]; color: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== undefined);
  if (pts.length < 2) return <span className="text-[var(--color-muted-foreground)]">·</span>;
  const w = 80;
  const h = 20;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const x = (i: number) => (i / 11) * (w - 4) + 2;
  const y = (v: number) => (max === min ? h / 2 : h - 2 - ((v - min) / (max - min)) * (h - 4));
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="block">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={2} fill={color} />
    </svg>
  );
}
