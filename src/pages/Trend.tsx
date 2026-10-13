import { Link, useParams } from "react-router-dom";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { ArrowLeft, Repeat } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-message";
import { ENTRY_SOURCE } from "@/components/EntriesDialog";
import { useBudget } from "@/hooks/useBudget";
import { useChartColors, type ChartColors } from "@/lib/chartColors";
import {
  addMonths,
  budgetFor,
  currentMonthKey,
  formatMoney,
  formatMoneyCompact,
  formatMonth,
  itemMonthTotal,
  KIND_LABEL,
  ledgerEntries,
  MONTH_SHORT,
  monthSlug,
  parseMonthKey,
  sumMoney,
  totalForCategoryMonth,
  type EntryScope,
} from "@/lib/budget";
import { activeIn, cadenceLabel, nextDue } from "@/lib/recurring";
import { formatDay } from "@/lib/transactions";

const MONTHS = 24;

/**
 * One line item's or category's history: 24 months of totals (with the budget, for a category),
 * stats for the last 12 months, every entry by month and its recurring entries.
 */
export function Trend({ kind }: { kind: "item" | "category" }) {
  const { id = "" } = useParams();
  const colors = useChartColors();
  const thisMonth = currentMonthKey();
  const first = addMonths(thisMonth, -(MONTHS - 1));
  const { categories, items, recurring, ledger, loading, error } = useBudget(first, addMonths(thisMonth, 1));

  const item = kind === "item" ? items.find((i) => i.id === id) : undefined;
  const category = categories.find((c) => c.id === (item?.category_id ?? id));
  const scope: EntryScope = { kind, id };

  if (loading) return <p className="text-[var(--color-muted-foreground)]">Loading…</p>;
  if (error) return <FormError>{error}</FormError>;
  if (!category || (kind === "item" && !item)) {
    return (
      <div className="space-y-3">
        <p>That {kind === "item" ? "line item" : "category"} doesn't exist anymore.</p>
        <Link to="/year" className="text-sm text-[var(--color-primary)] hover:underline">
          Back to the year
        </Link>
      </div>
    );
  }

  const name = item?.name ?? category.name;
  const months = Array.from({ length: MONTHS }, (_, k) => addMonths(first, k));
  const totalFor = (m: string) => (item ? (itemMonthTotal(ledger, item.id, m) ?? 0) : totalForCategoryMonth(ledger, category.id, m));
  const budgetOf = (m: string) => (item ? null : budgetFor(category, m));
  const hasBudget = months.some((m) => budgetOf(m) !== null);
  const fill = category.kind === "income" ? colors.income : category.kind === "savings" ? colors.savings : colors.spending;
  const data = months.map((m) => {
    return {
      month: m,
      label: MONTH_SHORT[parseMonthKey(m).month],
      Total: totalFor(m),
      Budget: budgetOf(m) ?? undefined,
    };
  });

  // Stats over the last 12 months; the average counts only months with something in them
  const last12 = data.slice(-12);
  const withData = last12.filter((d) => ledgerEntries(ledger, scope, d.month).length > 0);
  const total12 = sumMoney(last12.map((d) => d.Total));
  const average = withData.length ? total12 / withData.length : 0;
  const highest = withData.reduce<(typeof data)[number] | null>((a, d) => (!a || d.Total > a.Total ? d : a), null);
  const lowest = withData.reduce<(typeof data)[number] | null>((a, d) => (!a || d.Total < a.Total ? d : a), null);
  const current = totalFor(thisMonth);

  const history = [...months]
    .reverse()
    .map((m) => ({ month: m, entries: ledgerEntries(ledger, scope, m) }))
    .filter((p) => p.entries.length > 0);
  const repeating = recurring.filter(
    (r) => (item ? r.line_item_id === item.id : r.category_id === category.id) && (r.end_month === null || r.end_month >= thisMonth)
  );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          to={item ? `/categories/${category.id}` : `/year/${parseMonthKey(thisMonth).year}`}
          className="inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {item ? category.name : "Year"}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {item ? `Line item in ${category.name}` : `${KIND_LABEL[category.kind]} category`} · {formatMonth(first, "short")} –{" "}
          {formatMonth(thisMonth, "short")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Last 12 months" value={formatMoney(total12)} />
        <Stat label="Monthly average" value={formatMoney(average)} sub={`${withData.length} of 12 months had entries`} />
        <Stat
          label="Highest month"
          value={highest ? formatMoney(highest.Total) : "—"}
          sub={highest ? `${formatMonth(highest.month, "short")}${lowest ? ` · lowest ${formatMoney(lowest.Total)} in ${formatMonth(lowest.month, "short")}` : ""}` : undefined}
        />
        <Stat
          label={formatMonth(thisMonth, "short")}
          value={formatMoney(current)}
          sub={average ? `${current >= average ? "+" : "−"}${formatMoney(Math.abs(current - average))} vs average` : undefined}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">By month</CardTitle>
          <CardDescription>
            Manual entries and card charges{item ? "" : " across its line items and Other row"}
            {hasBudget ? "; the line is the monthly budget" : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent className="h-72 px-2 sm:px-6">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={colors.grid} />
              <XAxis
                dataKey="label"
                tick={(props: { x: number; y: number; payload: { index: number } }) => <MonthTick {...props} data={data} colors={colors} />}
                axisLine={false}
                tickLine={false}
                interval={0}
                height={36}
              />
              <YAxis tickFormatter={formatMoneyCompact} tick={{ fill: colors.axis, fontSize: 12 }} axisLine={false} tickLine={false} width={48} />
              <Tooltip content={<TrendTooltip colors={colors} />} cursor={{ fill: colors.grid, opacity: 0.5 }} />
              {hasBudget && (
                <Legend
                  wrapperStyle={{ fontSize: 12 }}
                  iconType="circle"
                  iconSize={10}
                  formatter={(v: string) => <span style={{ color: colors.axis }}>{v}</span>}
                />
              )}
              <Bar isAnimationActive={false} dataKey="Total" name={name} fill={fill} radius={[4, 4, 0, 0]} maxBarSize={22} />
              {hasBudget && (
                <Line
                  isAnimationActive={false}
                  dataKey="Budget"
                  type="stepAfter"
                  stroke={colors.neutral}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {repeating.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Recurring</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-[var(--color-border)]">
              {repeating.map((r) => {
                const next = activeIn(r, thisMonth) ? thisMonth : nextDue(r, thisMonth);
                return (
                  <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                    <Repeat className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                        {cadenceLabel(r.every_months)} since {formatMonth(r.start_month, "short")}
                        {next && next !== thisMonth ? ` · next ${formatMonth(next, "short")}` : ""}
                      </span>
                    </span>
                    <span className="font-medium tabular-nums">{r.amount_varies ? "Varies" : formatMoney(r.amount, true)}</span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Every entry</CardTitle>
          <CardDescription>Newest first. Open a month to change its entries.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {history.length === 0 && <p className="text-sm text-[var(--color-muted-foreground)]">Nothing in the last {MONTHS} months.</p>}
          {history.map((p) => (
            <section key={p.month}>
              <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] pb-2 text-sm font-semibold">
                <Link to={`/month/${monthSlug(p.month)}`} className="hover:underline">
                  {formatMonth(p.month)}
                </Link>
                <span className="tabular-nums">{formatMoney(sumMoney(p.entries.map((e) => e.amount)), true)}</span>
              </div>
              <ul className="divide-y divide-[var(--color-border)]">
                {p.entries.map((e) => {
                  const { icon: Icon, label } = ENTRY_SOURCE[e.source];
                  const detail = [e.postedOn ? formatDay(e.postedOn) : label, !item && (e.itemName ?? "Other")].filter(Boolean).join(" · ");
                  return (
                    <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                      <Icon className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-label={label} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{e.name}</span>
                        <span className="block truncate text-xs text-[var(--color-muted-foreground)]">{detail}</span>
                      </span>
                      <span className="font-medium tabular-nums">{formatMoney(e.amount, true)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** Month initial on every bar (the full name on wide screens), with the year under January and the first month */
function MonthTick({
  x,
  y,
  payload,
  data,
  colors,
}: {
  x: number;
  y: number;
  payload: { index: number };
  data: { month: string; label: string }[];
  colors: ChartColors;
}) {
  const d = data[payload.index];
  if (!d) return null;
  const { year, month } = parseMonthKey(d.month);
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={12} textAnchor="middle" fill={colors.axis} fontSize={11}>
        <tspan className="sm:hidden">{d.label[0]}</tspan>
        <tspan className="hidden sm:inline">{d.label}</tspan>
      </text>
      {(month === 0 || payload.index === 0) && (
        <text dy={26} textAnchor="middle" fill={colors.axis} fontSize={11} fontWeight={600}>
          {year}
        </text>
      )}
    </g>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="flex flex-col p-4 sm:p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-2 text-2xl font-extrabold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="mt-auto pt-2 text-xs text-[var(--color-muted-foreground)]">{sub}</div>}
    </Card>
  );
}

function TrendTooltip({ active, payload, colors }: TooltipProps<number, string> & { colors: ChartColors }) {
  if (!active || !payload?.length) return null;
  const month = (payload[0].payload as { month: string }).month;
  return (
    <div
      className="min-w-36 rounded-xl border px-3 py-2 text-xs shadow-lg"
      style={{ background: colors.tooltipBg, color: colors.tooltipText, borderColor: colors.grid }}
    >
      <div className="mb-1 font-medium">{formatMonth(month)}</div>
      {payload
        .filter((p) => typeof p.value === "number")
        .map((p) => (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
              {p.dataKey === "Budget" ? "Budget" : "Total"}
            </span>
            <span className="tabular-nums">{formatMoney(p.value as number)}</span>
          </div>
        ))}
    </div>
  );
}
