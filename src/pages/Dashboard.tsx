import { useRef, useState } from "react";
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
import { CreditCard, PencilLine, PenLine, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-message";
import { BudgetBar } from "@/components/BudgetBar";
import { EmptyBudget } from "@/components/EmptyBudget";
import { OneOffDialog } from "@/components/OneOffDialog";
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
import { countsOnItsOwn, formatDay } from "@/lib/transactions";

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

  // The month the lower half of the page shows (?month=, else the latest month with data)
  const monthParam = searchParams.get("month");
  const selectedMonth =
    monthParam && /^\d{1,2}$/.test(monthParam) && +monthParam >= 1 && +monthParam <= 12
      ? monthKey(year, +monthParam - 1)
      : (lastWithData ?? (thisYear === year ? thisMonth : monthKey(year, 11)));
  const selectedIdx = parseMonthKey(selectedMonth).month;
  const monthLink = `/month/${monthSlug(selectedMonth)}`;
  const lastShownIdx = shownMonths.length - 1;
  const yearLabel = `Jan–${MONTH_SHORT[lastShownIdx]} ${year}`;

  // Year so far vs the same months last year; the month vs the month before
  const yearSummary = sumSummaries(summaries.slice(0, lastShownIdx + 1));
  const lastYearSummaries = shownMonths.map((_, m) => summarizeMonth(ledger, monthKey(year - 1, m)));
  const lastYearSummary = lastYearSummaries.some((s) => s.hasData) ? sumSummaries(lastYearSummaries) : null;
  const monthSummary = summaries[selectedIdx];
  const prevMonthSummary = summarizeMonth(ledger, addMonths(selectedMonth, -1));

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

  const breakdownFor = (ms: string[]) =>
    spendGroups
      .map((g) => ({ name: g.name, total: sumMoney(ms.map(g.total)) }))
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total);
  const yearBreakdown = breakdownFor(shownMonths);
  const monthBreakdown = breakdownFor([selectedMonth]);

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

  // Budget vs actual for the month, for categories that have a monthly budget
  const budgetRows = categories
    .filter((c) => c.monthly_budget != null && c.kind !== "income" && !c.archived)
    .map((c) => ({ cat: c, budget: c.monthly_budget!, spent: totalForCategoryMonth(ledger, c.id, selectedMonth) }));
  const budgetRemaining = sumMoney([...budgetRows.map((r) => r.budget), ...budgetRows.map((r) => -r.spent)]);

  // Biggest purchases this month: counted card charges and one-time manual entries, spending only
  const itemById = new Map(items.map((i) => [i.id, i]));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const placeOf = (lineItemId: string | null, categoryId: string | null) => {
    const item = lineItemId ? itemById.get(lineItemId) : undefined;
    const cat = catById.get(item?.category_id ?? categoryId ?? "");
    return { kind: cat?.kind, name: item?.name ?? cat?.name ?? "Uncategorized" };
  };
  const isSpending = (kind: string | undefined) => !kind || kind === "expense";
  const purchases: Purchase[] = [
    ...ledger.transactions
      .filter((t) => t.month === selectedMonth && countsOnItsOwn(t) && t.amount > 0)
      .map((t) => ({ t, place: placeOf(t.line_item_id, t.category_id) }))
      .filter(({ place }) => isSpending(place.kind))
      .map(({ t, place }) => ({
        id: t.id,
        name: t.merchant || t.description,
        detail: `${formatDay(t.posted_on)} · ${place.name}`,
        amount: t.amount,
        oneOff: null,
      })),
    ...oneOffs
      .filter((o) => o.month === selectedMonth && !o.repeats && o.amount > 0)
      .map((o) => ({ o, place: placeOf(o.line_item_id, o.category_id) }))
      .filter(({ place }) => isSpending(place.kind))
      .map(({ o, place }) => ({ id: o.id, name: o.name, detail: `Manual entry · ${place.name}`, amount: o.amount, oneOff: o })),
  ]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const activeItemCount = items.filter((i) => !i.archived).length;

  function setYear(y: number) {
    setSearchParams({ year: String(y) });
  }
  const monthSectionRef = useRef<HTMLElement>(null);
  function selectMonth(key: string, reveal = false) {
    const { year: y, month: m } = parseMonthKey(key);
    setSearchParams({ year: String(y), month: String(m + 1) }, { preventScrollReset: true });
    // From the charts, bring the month section into view if it's below the fold
    const el = monthSectionRef.current;
    if (reveal && el && el.getBoundingClientRect().top > window.innerHeight * 0.6) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  function onChartClick(state: { activeTooltipIndex?: number } | null) {
    const m = state?.activeTooltipIndex != null ? shownMonths[state.activeTooltipIndex] : undefined;
    if (m) selectMonth(m, true);
  }
  const dim = (m: string) => (m === selectedMonth ? 1 : 0.4);
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
        onClick={() => m && selectMonth(m, true)}
      >
        {props.payload.value}
      </text>
    );
  };

  if (!loading && !error && categories.length === 0) return <EmptyBudget onSeeded={reload} />;

  return (
    <div className="space-y-6">
      <StepperNav
        label={String(year)}
        onPrev={() => setYear(year - 1)}
        onNext={() => setYear(year + 1)}
        prevLabel="Previous year"
        nextLabel="Next year"
        picker={{ mode: "year", value: year, onSelect: setYear }}
        onToday={year !== thisYear ? () => setYear(thisYear) : undefined}
        todayLabel="This year"
      />

      {error && <FormError>{error}</FormError>}

      {loading ? (
        <p className="text-[var(--color-muted-foreground)]">Loading…</p>
      ) : (
        <>
          {/* ---------- The year ---------- */}
          <section className="space-y-6">
            <SectionHeading
              eyebrow="Year"
              title={year === thisYear ? `${year} so far` : String(year)}
              subtitle={`${yearLabel}${lastYearSummary ? `, compared with the same months in ${year - 1}` : ""}`}
            />
            <SummaryTiles
              current={yearSummary}
              previous={lastYearSummary}
              compareLabel={`vs same period ${year - 1}`}
              colors={colors}
            />

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Income vs spending by month</CardTitle>
                <CardDescription>
                  "Left over" is income minus spending and savings. Click a month to see it below.
                </CardDescription>
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
                  <CardDescription>Monthly spending, stacked by category (excludes savings). Click a month to see it below.</CardDescription>
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

              <BreakdownCard title="Where the money went" description={yearLabel} rows={yearBreakdown} colors={colors} />
            </div>
          </section>

          {/* ---------- The selected month ---------- */}
          <section ref={monthSectionRef} className="scroll-mt-20 space-y-6 border-t border-[var(--color-border)] pt-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1">
                <p className={eyebrowClass}>Month</p>
                <StepperNav
                  size="md"
                  label={formatMonth(selectedMonth)}
                  onPrev={() => selectMonth(addMonths(selectedMonth, -1))}
                  onNext={() => selectMonth(addMonths(selectedMonth, 1))}
                  prevLabel="Previous month"
                  nextLabel="Next month"
                  picker={{ mode: "month", value: selectedMonth, onSelect: (m) => selectMonth(m) }}
                  onToday={selectedMonth !== thisMonth ? () => selectMonth(thisMonth) : undefined}
                  todayLabel="This month"
                />
              </div>
              <Button asChild size="sm">
                <Link to={monthLink}>
                  <PencilLine /> Open {MONTH_SHORT[selectedIdx]}
                </Link>
              </Button>
            </div>
            <SummaryTiles
              current={monthSummary}
              previous={prevMonthSummary}
              compareLabel={`vs ${formatMonth(prevMonth, "short")}`}
              colors={colors}
            />
            {monthSummary.entered < activeItemCount && monthSummary.entered > 0 && (
              <p className="-mt-3 text-xs text-[var(--color-muted-foreground)]">
                {monthSummary.entered} of {activeItemCount} line items have something this month.{" "}
                <Link className="underline" to={monthLink}>
                  Finish entering
                </Link>
              </p>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              <BreakdownCard
                title="Where the money went"
                description={formatMonth(selectedMonth)}
                rows={monthBreakdown}
                colors={colors}
              />

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <ShoppingBag className="h-4 w-4" aria-hidden /> Biggest purchases
                  </CardTitle>
                  <CardDescription>
                    {purchases.length
                      ? `Largest card charges and manual entries in ${formatMonth(selectedMonth)}.`
                      : `No purchases in ${formatMonth(selectedMonth)} yet.`}
                  </CardDescription>
                </CardHeader>
                {purchases.length > 0 && (
                  <ul className="divide-y divide-[var(--color-border)] pb-2">
                    {purchases.map((p) => {
                      const Icon = p.oneOff ? PenLine : CreditCard;
                      const content = (
                        <>
                          <Icon className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{p.name}</span>
                            <span className="block truncate text-xs text-[var(--color-muted-foreground)]">{p.detail}</span>
                          </span>
                          <span className="font-medium tabular-nums">{formatMoney(p.amount, true)}</span>
                        </>
                      );
                      return (
                        <li key={p.id}>
                          {p.oneOff ? (
                            <button type="button" className={purchaseRowClass} onClick={() => setEditingOneOff(p.oneOff)}>
                              {content}
                            </button>
                          ) : (
                            <Link to={monthLink} className={purchaseRowClass}>
                              {content}
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Budget vs actual</CardTitle>
                  <CardDescription>
                    {budgetRows.length
                      ? `${formatMonth(selectedMonth)}: ${budgetRemaining >= 0 ? `${formatMoney(budgetRemaining)} left` : `${formatMoney(-budgetRemaining)} over`} across budgeted categories`
                      : "Set monthly budgets on categories in Settings."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {budgetRows.length === 0 ? (
                    <Button asChild variant="outline" size="sm">
                      <Link to="/settings">Set budgets</Link>
                    </Button>
                  ) : (
                    budgetRows.map((r) => (
                      <div key={r.cat.id}>
                        <Link to={monthLink} className="mb-1 block text-sm font-medium hover:underline">
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
                  <CardTitle className="text-lg">Biggest changes vs {formatMonth(prevMonth, "short")}</CardTitle>
                  <CardDescription>Spending line items that moved the most in {formatMonth(selectedMonth)}.</CardDescription>
                </CardHeader>
                <CardContent>
                  {changes.length === 0 ? (
                    <p className="text-sm text-[var(--color-muted-foreground)]">No changes to show.</p>
                  ) : (
                    <ul className="divide-y divide-[var(--color-border)]">
                      {changes.map((c) => (
                        <li key={c.item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                          <Link to={monthLink} className="truncate hover:underline">
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
            </div>
          </section>
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

type Purchase = { id: string; name: string; detail: string; amount: number; oneOff: OneOff | null };

const eyebrowClass = "text-xs font-bold uppercase tracking-wider text-[var(--color-primary)]";
const purchaseRowClass = "flex w-full items-center gap-3 px-6 py-2 text-left text-sm hover:bg-[var(--color-accent)]";

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="space-y-1">
      <p className={eyebrowClass}>{eyebrow}</p>
      <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      <p className="text-sm text-[var(--color-muted-foreground)]">{subtitle}</p>
    </div>
  );
}

/** Horizontal bars of spending per category for a period. */
function BreakdownCard({
  title,
  description,
  rows,
  colors,
}: {
  title: string;
  description: string;
  rows: { name: string; total: number }[];
  colors: ChartColors;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6" style={{ height: Math.max(160, rows.length * 34 + 24) }}>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-[var(--color-muted-foreground)]">No spending entered yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }}>
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
