import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { ArrowRight, PencilLine, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-message";
import { BudgetBar } from "@/components/BudgetBar";
import { EmptyBudget } from "@/components/EmptyBudget";
import { OneOffDialog } from "@/components/OneOffDialog";
import { OneOffList } from "@/components/OneOffList";
import { StepperNav } from "@/components/StepperNav";
import { SummaryTiles } from "@/components/SummaryTiles";
import { useBudget } from "@/hooks/useBudget";
import { useChartColors, type ChartColors } from "@/lib/chartColors";
import {
  addMonths,
  currentMonthKey,
  formatMoney,
  formatMoneyCompact,
  formatMonth,
  itemMonthTotal,
  monthKey,
  monthSlug,
  MONTH_SHORT,
  parseMonthKey,
  summarizeMonth,
  sumMoney,
  totalForCategoryMonth,
  uncategorizedTotal,
  type OneOff,
  type MonthSummary,
} from "@/lib/budget";
import { cn } from "@/lib/utils";

const MAX_CATEGORY_SERIES = 7; // 8th slot is "Other"

export function Dashboard() {
  const colors = useChartColors();
  const [searchParams, setSearchParams] = useSearchParams();
  const thisMonth = currentMonthKey();
  const thisYear = parseMonthKey(thisMonth).year;
  const year = Number(searchParams.get("year")) || thisYear;

  const { categories, items, oneOffs, recurring, ledger, loading, error, reload, refresh, applyOneOff } = useBudget(
    monthKey(year - 1, 0),
    monthKey(year + 1, 0)
  );
  const [breakdownScope, setBreakdownScope] = useState<"month" | "year">("month");
  const [budgetScope, setBudgetScope] = useState<"month" | "year">("month");
  const [editingOneOff, setEditingOneOff] = useState<OneOff | null>(null);

  const months = Array.from({ length: 12 }, (_, m) => monthKey(year, m));
  const summaries = months.map((m) => summarizeMonth(ledger, m));
  const lastWithData = [...summaries].reverse().find((s) => s.hasData)?.month ?? null;
  const shownMonths = lastWithData ? months.filter((m) => m <= lastWithData) : months;

  const monthParam = searchParams.get("month");
  const defaultMonth =
    lastWithData ?? (parseMonthKey(thisMonth).year === year ? thisMonth : monthKey(year, 11));
  const selectedMonth =
    monthParam && /^\d{1,2}$/.test(monthParam) && +monthParam >= 1 && +monthParam <= 12
      ? monthKey(year, +monthParam - 1)
      : defaultMonth;
  const selectedIdx = parseMonthKey(selectedMonth).month;

  const current = summaries[selectedIdx];
  const previous = summarizeMonth(ledger, addMonths(selectedMonth, -1));

  // Year to date through the selected month, vs the same months last year
  const ytd = sumSummaries(summaries.slice(0, selectedIdx + 1));
  const lastYearSummaries = Array.from({ length: selectedIdx + 1 }, (_, m) =>
    summarizeMonth(ledger, monthKey(year - 1, m))
  );
  const lastYtd = lastYearSummaries.some((s) => s.hasData) ? sumSummaries(lastYearSummaries) : null;

  // Spending groups: expense categories plus uncategorized entries and unfiled card charges
  const spendGroups: SpendGroup[] = [
    ...categories
      .filter((c) => c.kind === "expense")
      .map((c) => ({ id: c.id, name: c.name, total: (m: string) => totalForCategoryMonth(ledger, c.id, m) })),
    { id: "uncategorized", name: "Uncategorized", total: (m: string) => uncategorizedTotal(ledger, m) },
  ];
  const groupYearTotals = spendGroups
    .map((g) => ({ group: g, total: sumMoney(shownMonths.map(g.total)) }))
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total);
  // Color follows the category, not its rank: assign slots by the category's sort order
  const seriesIds = new Set(groupYearTotals.slice(0, MAX_CATEGORY_SERIES).map((g) => g.group.id));
  const orderedSeries = spendGroups.filter((g) => seriesIds.has(g.id));
  const hasOther = groupYearTotals.length > MAX_CATEGORY_SERIES;

  const monthlyData = shownMonths.map((m, i) => ({
    label: MONTH_SHORT[parseMonthKey(m).month],
    month: m,
    Income: summaries[i].income,
    Spending: summaries[i].spending,
    Saved: summaries[i].savings,
    "Left over": summaries[i].net,
  }));

  const stackedData = shownMonths.map((m) => {
    const row: Record<string, number | string> = { label: MONTH_SHORT[parseMonthKey(m).month], month: m };
    let other = 0;
    for (const g of spendGroups) {
      const v = g.total(m);
      if (seriesIds.has(g.id)) row[g.name] = v;
      else other += v;
    }
    if (hasOther) row.Other = Math.round(other * 100) / 100;
    return row;
  });

  const breakdownMonths = breakdownScope === "month" ? [selectedMonth] : months.slice(0, selectedIdx + 1);
  const breakdown = spendGroups
    .map((g) => ({ name: g.name, total: sumMoney(breakdownMonths.map(g.total)) }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  // Biggest line-item moves vs the previous month
  const prevMonth = addMonths(selectedMonth, -1);
  const changes = items
    .filter((i) => ledger.kindByCategory.get(i.category_id) === "expense")
    .map((i) => {
      const now = itemMonthTotal(ledger, i.id, selectedMonth);
      const before = itemMonthTotal(ledger, i.id, prevMonth);
      return { item: i, now: now ?? 0, before: before ?? 0, delta: (now ?? 0) - (before ?? 0), known: now !== undefined };
    })
    .filter((c) => c.known && Math.abs(c.delta) >= 1)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);

  // Budget vs actual for categories that have a monthly budget
  const budgetMonths = budgetScope === "month" ? [selectedMonth] : months.slice(0, selectedIdx + 1);
  const budgetRows = categories
    .filter((c) => c.monthly_budget != null && c.kind !== "income" && !c.archived)
    .map((c) => ({
      cat: c,
      budget: sumMoney(budgetMonths.map(() => c.monthly_budget!)),
      spent: sumMoney(budgetMonths.map((m) => totalForCategoryMonth(ledger, c.id, m))),
    }));
  const budgetRemaining = sumMoney([...budgetRows.map((r) => r.budget), ...budgetRows.map((r) => -r.spent)]);

  // Biggest one-time spending: skip repeating entries (rent, wages) and income/savings
  const bigPurchases = oneOffs
    .filter(
      (o) =>
        o.month.startsWith(`${year}-`) &&
        !o.recurring_id &&
        (!o.category_id || ledger.kindByCategory.get(o.category_id) === "expense")
    )
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  function setYear(y: number) {
    setSearchParams({ year: String(y) });
  }
  function selectMonth(key: string) {
    const { year: y, month: m } = parseMonthKey(key);
    setSearchParams({ year: String(y), month: String(m + 1) }, { preventScrollReset: true });
  }
  // Clicking anywhere in a month's column focuses that month
  function onChartClick(state: { activeTooltipIndex?: number } | null) {
    const m = state?.activeTooltipIndex != null ? shownMonths[state.activeTooltipIndex] : undefined;
    if (m) selectMonth(m);
  }
  const dim = (m: string) => (m === selectedMonth ? 1 : 0.35);
  const monthCells = shownMonths.map((m) => <Cell key={m} fillOpacity={dim(m)} />);
  const monthTick = (props: { x: number; y: number; payload: { value: string; index: number } }) => {
    const m = shownMonths[props.payload.index];
    return (
      <text
        x={props.x}
        y={props.y}
        dy={12}
        textAnchor="middle"
        fontSize={12}
        fill={m === selectedMonth ? colors.tooltipText : colors.axis}
        fontWeight={m === selectedMonth ? 700 : 400}
        className="cursor-pointer"
        onClick={() => m && selectMonth(m)}
      >
        {props.payload.value}
      </text>
    );
  };

  if (!loading && !error && categories.length === 0) return <EmptyBudget onSeeded={reload} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StepperNav
          label={
            <>
              {year} <span className="text-[var(--color-muted-foreground)]">· {MONTH_SHORT[selectedIdx]}</span>
            </>
          }
          onPrev={() => setYear(year - 1)}
          onNext={() => setYear(year + 1)}
          prevLabel="Previous year"
          nextLabel="Next year"
          picker={{ mode: "month", value: selectedMonth, onSelect: selectMonth }}
          onToday={selectedMonth !== thisMonth ? () => selectMonth(thisMonth) : undefined}
          todayLabel="This month"
        />
        <div className="flex items-center gap-2">
          <Button asChild size="sm">
            <Link to={`/month/${monthSlug(selectedMonth)}`}>
              <PencilLine /> Enter {MONTH_SHORT[selectedIdx]}
            </Link>
          </Button>
        </div>
      </div>

      {error && <FormError>{error}</FormError>}

      {loading ? (
        <p className="text-[var(--color-muted-foreground)]">Loading…</p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              <Link
                to={`/month/${monthSlug(selectedMonth)}`}
                className="inline-flex items-center gap-1 hover:text-[var(--color-foreground)] hover:underline"
              >
                {formatMonth(selectedMonth)} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </h2>
            <SummaryTiles current={current} previous={previous} compareLabel="vs last month" colors={colors} />
            {current.entered < items.filter((i) => !i.archived).length && current.entered > 0 && (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {current.entered} of {items.filter((i) => !i.archived).length} line items have something this month.{" "}
                <Link className="underline" to={`/month/${monthSlug(selectedMonth)}`}>
                  Finish entering
                </Link>
              </p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Year to date (Jan–{MONTH_SHORT[selectedIdx]} {year})
            </h2>
            <SummaryTiles
              current={ytd}
              previous={lastYtd}
              compareLabel={`vs same period ${year - 1}`}
              colors={colors}
            />
          </section>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Income vs spending by month</CardTitle>
              <CardDescription>"Left over" is income minus spending and savings. Click a month to focus it.</CardDescription>
            </CardHeader>
            <CardContent className="h-80 px-2 sm:px-6">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={monthlyData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  barGap={2}
                  onClick={onChartClick}
                  className="cursor-pointer"
                >
                  <CartesianGrid vertical={false} stroke={colors.grid} />
                  <XAxis dataKey="label" tick={monthTick} axisLine={false} tickLine={false} />
                  <YAxis
                    tickFormatter={formatMoneyCompact}
                    tick={{ fill: colors.axis, fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip content={<MoneyTooltip colors={colors} />} cursor={{ fill: colors.grid, opacity: 0.5 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={10} formatter={legendText(colors)} />
                  <Bar isAnimationActive={false} dataKey="Income" fill={colors.income} radius={[6, 6, 0, 0]} maxBarSize={22}>
                    {monthCells}
                  </Bar>
                  <Bar isAnimationActive={false} dataKey="Spending" fill={colors.spending} radius={[6, 6, 0, 0]} maxBarSize={22}>
                    {monthCells}
                  </Bar>
                  <Bar isAnimationActive={false} dataKey="Saved" fill={colors.savings} radius={[6, 6, 0, 0]} maxBarSize={22}>
                    {monthCells}
                  </Bar>
                  <Line
                    isAnimationActive={false}
                    dataKey="Left over"
                    stroke={colors.neutral}
                    strokeWidth={2}
                    dot={(p: { cx?: number; cy?: number; index: number }) => (
                      <circle
                        key={p.index}
                        cx={p.cx}
                        cy={p.cy}
                        r={shownMonths[p.index] === selectedMonth ? 5 : 4}
                        fill={colors.neutral}
                        fillOpacity={dim(shownMonths[p.index])}
                        stroke={colors.surface}
                        strokeWidth={2}
                      />
                    )}
                    activeDot={{ r: 5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Spending by category</CardTitle>
                <CardDescription>Monthly spending, stacked by category (excludes savings). Click a month to focus it.</CardDescription>
              </CardHeader>
              <CardContent className="h-80 px-2 sm:px-6">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={stackedData}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    onClick={onChartClick}
                    className="cursor-pointer"
                  >
                    <CartesianGrid vertical={false} stroke={colors.grid} />
                    <XAxis dataKey="label" tick={monthTick} axisLine={false} tickLine={false} />
                    <YAxis
                      tickFormatter={formatMoneyCompact}
                      tick={{ fill: colors.axis, fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <Tooltip content={<MoneyTooltip colors={colors} showTotal />} cursor={{ fill: colors.grid, opacity: 0.5 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={10} formatter={legendText(colors)} />
                    {orderedSeries.map((c, i) => (
                      <Bar
                        isAnimationActive={false}
                        key={c.id}
                        dataKey={c.name}
                        stackId="s"
                        fill={colors.categorical[i]}
                        stroke={colors.surface}
                        strokeWidth={1}
                        maxBarSize={32}
                      >
                        {monthCells}
                      </Bar>
                    ))}
                    {hasOther && (
                      <Bar isAnimationActive={false} dataKey="Other" stackId="s" fill={colors.neutral} stroke={colors.surface} strokeWidth={1} maxBarSize={32}>
                        {monthCells}
                      </Bar>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                <div className="space-y-1.5">
                  <CardTitle className="text-lg">Where the money went</CardTitle>
                  <CardDescription>
                    {breakdownScope === "month" ? formatMonth(selectedMonth) : `Jan–${MONTH_SHORT[selectedIdx]} ${year}`}
                  </CardDescription>
                </div>
                <ScopeToggle scope={breakdownScope} onChange={setBreakdownScope} />
              </CardHeader>
              <CardContent className="px-2 sm:px-6" style={{ height: Math.max(160, breakdown.length * 34 + 24) }}>
                {breakdown.length === 0 ? (
                  <p className="p-4 text-sm text-[var(--color-muted-foreground)]">No spending entered yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={breakdown} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={120}
                        tick={{ fill: colors.axis, fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<MoneyTooltip colors={colors} />} cursor={{ fill: colors.grid, opacity: 0.5 }} />
                      <Bar isAnimationActive={false} dataKey="total" name="Spent" fill={colors.spending} radius={[0, 6, 6, 0]} maxBarSize={20}>
                        <LabelList
                          dataKey="total"
                          position="right"
                          formatter={(v: number) => formatMoney(v)}
                          style={{ fill: colors.tooltipText, fontSize: 12 }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                <div className="space-y-1.5">
                  <CardTitle className="text-lg">Budget vs actual</CardTitle>
                  <CardDescription>
                    {budgetRows.length
                      ? `${budgetRemaining >= 0 ? `${formatMoney(budgetRemaining)} left` : `${formatMoney(-budgetRemaining)} over`} across budgeted categories`
                      : "Set monthly budgets on categories in Settings."}
                  </CardDescription>
                </div>
                <ScopeToggle scope={budgetScope} onChange={setBudgetScope} />
              </CardHeader>
              <CardContent className="space-y-4">
                {budgetRows.length === 0 ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to="/settings">Set budgets</Link>
                  </Button>
                ) : (
                  budgetRows.map((r) => (
                    <div key={r.cat.id}>
                      <Link to={`/month/${monthSlug(selectedMonth)}`} className="mb-1 block text-sm font-medium hover:underline">
                        {r.cat.name}
                      </Link>
                      <BudgetBar spent={r.spent} budget={r.budget} />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShoppingBag className="h-4 w-4" aria-hidden /> Largest one-time entries
                </CardTitle>
                <CardDescription>
                  {bigPurchases.length
                    ? `Biggest manual spending entries in ${year} that don't repeat monthly.`
                    : `No one-time manual entries in ${year} yet.`}
                </CardDescription>
              </CardHeader>
              {bigPurchases.length > 0 && (
                <OneOffList oneOffs={bigPurchases} categories={categories} items={items} showMonth onEdit={setEditingOneOff} />
              )}
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Biggest changes vs {formatMonth(prevMonth, "short")}</CardTitle>
              <CardDescription>Spending line items that moved the most this month.</CardDescription>
            </CardHeader>
            <CardContent>
              {changes.length === 0 ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">No changes to show.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {changes.map((c) => (
                    <li key={c.item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <Link to={`/month/${monthSlug(selectedMonth)}`} className="truncate hover:underline">
                        {c.item.name}
                      </Link>
                      <span className="flex items-center gap-3 tabular-nums">
                        <span className="text-[var(--color-muted-foreground)]">
                          {formatMoney(c.before)} → {formatMoney(c.now)}
                        </span>
                        <span className="w-20 text-right font-medium">
                          {c.delta > 0 ? "+" : "−"}
                          {formatMoney(Math.abs(c.delta))}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
      {editingOneOff && (
        <OneOffDialog
          oneOff={editingOneOff}
          defaults={{ month: editingOneOff.month }}
          categories={categories}
          items={items}
          recurring={recurring}
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

type SpendGroup = { id: string; name: string; total: (month: string) => number };

function ScopeToggle({ scope, onChange }: { scope: "month" | "year"; onChange: (s: "month" | "year") => void }) {
  return (
    <div className="flex rounded-full bg-[var(--color-muted)] p-1 text-xs" role="group">
      {(["month", "year"] as const).map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={scope === s}
          onClick={() => onChange(s)}
          className={cn(
            "rounded-full px-3 py-1 font-semibold text-[var(--color-muted-foreground)]",
            scope === s && "bg-[var(--color-card)] text-[var(--color-foreground)] shadow-sm"
          )}
        >
          {s === "month" ? "Month" : "YTD"}
        </button>
      ))}
    </div>
  );
}

/** Legend labels in text ink, not the series color; the swatch carries identity. */
function legendText(colors: ChartColors) {
  return (value: string) => <span style={{ color: colors.axis }}>{value}</span>;
}

function sumSummaries(list: MonthSummary[]) {
  return {
    income: sumMoney(list.map((s) => s.income)),
    spending: sumMoney(list.map((s) => s.spending)),
    savings: sumMoney(list.map((s) => s.savings)),
    net: sumMoney(list.map((s) => s.net)),
  };
}

function MoneyTooltip({
  active,
  payload,
  label,
  colors,
  showTotal,
}: TooltipProps<number, string> & { colors: ChartColors; showTotal?: boolean }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => typeof p.value === "number");
  const total = sumMoney(rows.map((p) => p.value as number));
  return (
    <div
      className="min-w-40 rounded-xl border px-3 py-2 text-xs shadow-lg"
      style={{ background: colors.tooltipBg, color: colors.tooltipText, borderColor: colors.grid }}
    >
      {label && <div className="mb-1 font-medium">{label}</div>}
      {[...rows].reverse().map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
            {p.name}
          </span>
          <span className="tabular-nums">{formatMoney(p.value as number)}</span>
        </div>
      ))}
      {showTotal && rows.length > 1 && (
        <div className="mt-1 flex justify-between border-t pt-1 font-medium" style={{ borderColor: colors.grid }}>
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(total)}</span>
        </div>
      )}
    </div>
  );
}
