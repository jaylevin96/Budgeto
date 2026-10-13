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
import { ArrowRight, PencilLine, ShoppingBag, X } from "lucide-react";
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

const MAX_CATEGORY_SERIES = 7; // 8th slot is "Other"

export function Dashboard() {
  const colors = useChartColors();
  const [searchParams, setSearchParams] = useSearchParams();
  const thisMonth = currentMonthKey();
  const thisYear = parseMonthKey(thisMonth).year;
  const year = Number(searchParams.get("year")) || thisYear;

  const { categories, items, oneOffs, ledger, loading, error, reload, applyOneOff } = useBudget(
    monthKey(year - 1, 0),
    monthKey(year + 1, 0)
  );
  const [editingOneOff, setEditingOneOff] = useState<OneOff | null>(null);

  const months = Array.from({ length: 12 }, (_, m) => monthKey(year, m));
  const summaries = months.map((m) => summarizeMonth(ledger, m));
  const lastWithData = [...summaries].reverse().find((s) => s.hasData)?.month ?? null;
  const shownMonths = lastWithData ? months.filter((m) => m <= lastWithData) : months;

  // With ?month= the dashboard focuses that month; without it, it shows the year so far
  const monthParam = searchParams.get("month");
  const focusMonth =
    monthParam && /^\d{1,2}$/.test(monthParam) && +monthParam >= 1 && +monthParam <= 12
      ? monthKey(year, +monthParam - 1)
      : null;
  // The month "Enter" and "Biggest changes" use when no month is focused
  const refMonth = focusMonth ?? lastWithData ?? (thisYear === year ? thisMonth : monthKey(year, 11));
  const refIdx = parseMonthKey(refMonth).month;
  const periodMonths = focusMonth ? [focusMonth] : shownMonths;
  const lastShownIdx = shownMonths.length - 1;
  const periodLabel = focusMonth ? formatMonth(focusMonth) : `Jan–${MONTH_SHORT[lastShownIdx]} ${year}`;
  const periodLink = focusMonth ? `/month/${monthSlug(focusMonth)}` : `/year/${year}`;

  const current = focusMonth ? summaries[refIdx] : sumSummaries(summaries.slice(0, lastShownIdx + 1));
  // A month compares with the month before; the year so far with the same months last year
  const lastYearSummaries = shownMonths.map((_, m) => summarizeMonth(ledger, monthKey(year - 1, m)));
  const previous = focusMonth
    ? summarizeMonth(ledger, addMonths(focusMonth, -1))
    : lastYearSummaries.some((s) => s.hasData)
      ? sumSummaries(lastYearSummaries)
      : null;

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

  const breakdown = spendGroups
    .map((g) => ({ name: g.name, total: sumMoney(periodMonths.map(g.total)) }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  // Biggest line-item moves vs the previous month
  const prevMonth = addMonths(refMonth, -1);
  const changes = items
    .filter((i) => ledger.kindByCategory.get(i.category_id) === "expense")
    .map((i) => {
      const now = itemMonthTotal(ledger, i.id, refMonth);
      const before = itemMonthTotal(ledger, i.id, prevMonth);
      return { item: i, now: now ?? 0, before: before ?? 0, delta: (now ?? 0) - (before ?? 0), known: now !== undefined };
    })
    .filter((c) => c.known && Math.abs(c.delta) >= 1)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);

  // Budget vs actual for categories that have a monthly budget
  const budgetRows = categories
    .filter((c) => c.monthly_budget != null && c.kind !== "income" && !c.archived)
    .map((c) => ({
      cat: c,
      budget: sumMoney(periodMonths.map(() => c.monthly_budget!)),
      spent: sumMoney(periodMonths.map((m) => totalForCategoryMonth(ledger, c.id, m))),
    }));
  const budgetRemaining = sumMoney([...budgetRows.map((r) => r.budget), ...budgetRows.map((r) => -r.spent)]);

  const activeItemCount = items.filter((i) => !i.archived).length;

  const bigPurchases = oneOffs
    .filter((o) => o.month.startsWith(`${year}-`))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);
  const yearOneOffTotal = sumMoney(oneOffs.filter((o) => o.month.startsWith(`${year}-`)).map((o) => o.amount));

  function setYear(y: number) {
    setSearchParams({ year: String(y) });
  }
  function selectMonth(key: string) {
    const { year: y, month: m } = parseMonthKey(key);
    setSearchParams({ year: String(y), month: String(m + 1) }, { preventScrollReset: true });
  }
  function clearMonth() {
    setSearchParams({ year: String(year) }, { preventScrollReset: true });
  }
  // Clicking a month focuses it; clicking the focused month again goes back to the whole year
  function toggleMonth(m: string) {
    if (m === focusMonth) clearMonth();
    else selectMonth(m);
  }
  function onChartClick(state: { activeTooltipIndex?: number } | null) {
    const m = state?.activeTooltipIndex != null ? shownMonths[state.activeTooltipIndex] : undefined;
    if (m) toggleMonth(m);
  }
  const dim = (m: string) => (!focusMonth || m === focusMonth ? 1 : 0.35);
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
        fill={m === focusMonth ? colors.tooltipText : colors.axis}
        fontWeight={m === focusMonth ? 700 : 400}
        className="cursor-pointer"
        onClick={() => m && toggleMonth(m)}
      >
        {props.payload.value}
      </text>
    );
  };

  if (!loading && !error && categories.length === 0) return <EmptyBudget onSeeded={reload} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <StepperNav
            label={
              focusMonth ? (
                <>
                  {year} <span className="text-[var(--color-muted-foreground)]">· {MONTH_SHORT[refIdx]}</span>
                </>
              ) : (
                String(year)
              )
            }
            onPrev={() => setYear(year - 1)}
            onNext={() => setYear(year + 1)}
            prevLabel="Previous year"
            nextLabel="Next year"
            picker={{ mode: "month", value: refMonth, onSelect: selectMonth }}
            onToday={focusMonth !== thisMonth ? () => selectMonth(thisMonth) : undefined}
            todayLabel="This month"
          />
          {focusMonth && (
            <Button variant="secondary" size="sm" className="h-8 px-3" onClick={clearMonth}>
              <X /> Whole year
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm">
            <Link to={`/month/${monthSlug(refMonth)}`}>
              <PencilLine /> Enter {MONTH_SHORT[refIdx]}
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
                to={periodLink}
                className="inline-flex items-center gap-1 hover:text-[var(--color-foreground)] hover:underline"
              >
                {focusMonth ? formatMonth(focusMonth) : `${year}${year === thisYear ? " so far" : ""} (Jan–${MONTH_SHORT[lastShownIdx]})`}{" "}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </h2>
            <SummaryTiles
              current={current}
              previous={previous}
              compareLabel={focusMonth ? "vs last month" : `vs same period ${year - 1}`}
              colors={colors}
            />
            {focusMonth && summaries[refIdx].entered < activeItemCount && summaries[refIdx].entered > 0 && (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {summaries[refIdx].entered} of {activeItemCount} items entered for this month.{" "}
                <Link className="underline" to={periodLink}>
                  Finish entering
                </Link>
              </p>
            )}
          </section>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Income vs spending by month</CardTitle>
              <CardDescription>"Left over" is income minus spending and savings. {focusMonth ? "Click it again to see the whole year." : "Click a month to focus it."}</CardDescription>
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
                        r={shownMonths[p.index] === focusMonth ? 5 : 4}
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
                <CardDescription>Monthly spending, stacked by category (excludes savings). {focusMonth ? "Click it again to see the whole year." : "Click a month to focus it."}</CardDescription>
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
                  <CardDescription>{periodLabel}</CardDescription>
                </div>
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
                      ? `${periodLabel}: ${budgetRemaining >= 0 ? `${formatMoney(budgetRemaining)} left` : `${formatMoney(-budgetRemaining)} over`} across budgeted categories`
                      : "Set monthly budgets on categories in Settings."}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {budgetRows.length === 0 ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to="/settings">Set budgets</Link>
                  </Button>
                ) : (
                  budgetRows.map((r) => (
                    <div key={r.cat.id}>
                      <Link to={periodLink} className="mb-1 block text-sm font-medium hover:underline">
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
                  <ShoppingBag className="h-4 w-4" aria-hidden /> Largest entries
                </CardTitle>
                <CardDescription>
                  {bigPurchases.length
                    ? `${formatMoney(yearOneOffTotal)} in entries in ${year}.`
                    : `No entries in ${year} yet.`}
                </CardDescription>
              </CardHeader>
              {bigPurchases.length > 0 && (
                <OneOffList oneOffs={bigPurchases} categories={categories} items={items} showMonth onEdit={setEditingOneOff} />
              )}
              <div className="px-4 pb-4 pt-2">
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/entries?year=${year}`}>See all entries</Link>
                </Button>
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">
                Biggest changes: {formatMonth(refMonth, "short")} vs {formatMonth(prevMonth, "short")}
              </CardTitle>
              <CardDescription>Spending line items that moved the most this month.</CardDescription>
            </CardHeader>
            <CardContent>
              {changes.length === 0 ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">No changes to show.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {changes.map((c) => (
                    <li key={c.item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <Link to={`/month/${monthSlug(refMonth)}`} className="truncate hover:underline">
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

type SpendGroup = { id: string; name: string; total: (month: string) => number };

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
