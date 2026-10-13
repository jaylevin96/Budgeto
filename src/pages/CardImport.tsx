import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, CreditCard, Undo2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, FormSuccess } from "@/components/ui/form-message";
import { Select } from "@/components/ui/select";
import { DestinationSelect } from "@/components/CardTransactions";
import { parseAmexStatement, type ParsedStatement } from "@/lib/amex";
import {
  addMonths,
  fetchAmounts,
  fetchOneOffs,
  fetchStructure,
  formatMoney,
  formatMonth,
  indexAmounts,
  monthSlug,
  sumMoney,
  type AmountIndex,
  type Category,
  type LineItem,
  type OneOff,
} from "@/lib/budget";
import { buildReview, ONE_OFF_THRESHOLD, type ReviewRow } from "@/lib/cardReview";
import {
  deleteImport,
  EXCLUDE,
  fetchExistingRefs,
  fetchImports,
  fetchRules,
  formatDay,
  parseDestination,
  saveMerchantRules,
  saveStatement,
  type ImportRecord,
} from "@/lib/transactions";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type Loaded = {
  statement: ParsedStatement;
  fileName: string;
  /** Rows not imported before */
  rows: ReviewRow[];
  alreadyImported: number;
  categories: Category[];
  items: LineItem[];
  oneOffs: OneOff[];
  /** Typed amounts for the statement's months, to warn about double counting */
  typed: AmountIndex;
};

const REASON_LABEL: Record<ReviewRow["reason"], string> = {
  payment: "Card payment",
  "merchant rule": "Your rule",
  "category rule": "Your rule",
  split: "Split with a friend",
  suggested: "Suggested",
  "matches one-off": "Matches a one-off",
  none: "",
};

/** One-offs that card charges already point at, so they aren't matched again */
async function fetchCoveredOneOffIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await supabase.from("transactions").select("one_off_id").in("one_off_id", ids);
  if (error) throw error;
  return new Set(data.map((r) => r.one_off_id as string));
}

export function CardImport() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ months: string[]; count: number; oneOffs: number } | null>(null);
  const [remember, setRemember] = useState(true);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [member, setMember] = useState("");
  const [history, setHistory] = useState<ImportRecord[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  async function loadHistory() {
    try {
      setHistory(await fetchImports());
      setHistoryError(null);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Could not load past imports");
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function handleFile(file: File | undefined) {
    setError(null);
    setDone(null);
    setLoaded(null);
    setRows([]);
    if (!file) return;
    setBusy(true);
    try {
      const statement = await parseAmexStatement(await file.arrayBuffer());
      const monthsInFile = [...new Set(statement.rows.map((r) => r.month))].sort();
      const from = monthsInFile[0];
      const to = addMonths(monthsInFile[monthsInFile.length - 1], 1);
      const [structure, rules, existing, amounts, oneOffs] = await Promise.all([
        fetchStructure(),
        fetchRules(),
        fetchExistingRefs(statement.rows.map((r) => r.externalId)),
        fetchAmounts(from, to),
        fetchOneOffs(from, to),
      ]);
      const covered = await fetchCoveredOneOffIds(oneOffs.map((o) => o.id));
      const fresh = statement.rows.filter((r) => !existing.has(r.externalId));
      const review = buildReview(fresh, rules, structure.items, structure.categories, oneOffs, covered);
      setLoaded({
        statement,
        fileName: file.name,
        rows: review,
        alreadyImported: statement.rows.length - fresh.length,
        ...structure,
        oneOffs,
        typed: indexAmounts(amounts),
      });
      setRows(review);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    } finally {
      setBusy(false);
    }
  }

  /** Change one row; untouched rows from the same merchant follow along (not for one-off links). */
  function setValue(target: ReviewRow, value: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r === target) return { ...r, value, touched: true, makeOneOff: value === EXCLUDE || value.startsWith("oneoff:") ? false : r.makeOneOff };
        if (!value.startsWith("oneoff:") && !r.touched && r.row.merchant === target.row.merchant && r.reason !== "payment" && !r.value.startsWith("oneoff:")) {
          return { ...r, value };
        }
        return r;
      })
    );
  }

  const setOneOff = (target: ReviewRow, makeOneOff: boolean) =>
    setRows((prev) => prev.map((r) => (r === target ? { ...r, makeOneOff } : r)));

  async function handleImport() {
    if (!loaded || !rows.length) return;
    setBusy(true);
    setError(null);
    try {
      const reviewed = rows.map((r) => ({ row: r.row, destination: parseDestination(r.value), makeOneOff: r.makeOneOff }));
      const { oneOffs } = await saveStatement(loaded.statement, loaded.fileName, reviewed, loaded.items);
      if (remember) {
        await saveMerchantRules(rows.filter((r) => r.touched).map((r) => ({ merchant: r.row.merchant, destination: parseDestination(r.value) })));
      }
      setDone({ months: [...new Set(rows.map((r) => r.row.month))].sort(), count: rows.length, oneOffs: oneOffs.length });
      setLoaded(null);
      setRows([]);
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo(imp: ImportRecord) {
    const label = imp.period_start && imp.period_end ? `${formatDay(imp.period_start)}–${formatDay(imp.period_end)}` : imp.file_name;
    if (!window.confirm(`Undo the ${label} import? Its ${imp.row_count} card charges, and any one-offs made from them, will be deleted.`)) return;
    try {
      await deleteImport(imp.id);
      setDone(null);
      loadHistory();
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Could not undo");
    }
  }

  // ---------- Derived ----------
  const itemById = useMemo(() => new Map((loaded?.items ?? []).map((i) => [i.id, i])), [loaded]);
  const oneOffById = useMemo(() => new Map((loaded?.oneOffs ?? []).map((o) => [o.id, o])), [loaded]);
  const members = [...new Set(rows.map((r) => r.row.cardMember).filter((m): m is string => !!m))];

  /** Typed amount already in the cell this charge would add to */
  const typedClash = (r: ReviewRow) => {
    if (!r.value || r.value === EXCLUDE || r.value.startsWith("oneoff:") || r.makeOneOff) return null;
    return loaded?.typed.get(r.value)?.get(r.row.month) ?? null;
  };
  const needsAttention = (r: ReviewRow) => r.value === "" || typedClash(r) !== null;
  const visible = rows.filter((r) => (!attentionOnly || needsAttention(r)) && (!member || r.row.cardMember === member));

  const parsedCharges = sumMoney(loaded?.statement.rows.filter((r) => r.amount > 0).map((r) => r.amount) ?? []);
  const parsedCredits = sumMoney(loaded?.statement.rows.filter((r) => r.amount < 0).map((r) => r.amount) ?? []);
  const summary = loaded?.statement.summary;
  const totalsMatch = summary ? summary.charges === parsedCharges && summary.credits === parsedCredits : null;

  const months = [...new Set(rows.map((r) => r.row.month))].sort();
  const byMonth = months.map((m) => {
    const list = rows.filter((r) => r.row.month === m);
    const counted = list.filter((r) => r.value !== EXCLUDE && !r.value.startsWith("oneoff:"));
    const filed = counted.filter((r) => r.value !== "");
    return {
      month: m,
      total: sumMoney(counted.map((r) => r.row.amount)),
      lines: new Set(filed.map((r) => r.value)).size,
      unfiled: counted.filter((r) => r.value === "").length,
      unfiledTotal: sumMoney(counted.filter((r) => r.value === "").map((r) => r.row.amount)),
      oneOffs: new Set(list.filter((r) => r.makeOneOff && r.value !== EXCLUDE).map((r) => `${r.row.merchant}|${r.value}`)).size,
      covered: sumMoney(list.filter((r) => r.value.startsWith("oneoff:")).map((r) => r.row.amount)),
    };
  });
  // Months the statement only partly covers (it starts after the 1st or ends before month end)
  const partial = loaded?.statement.periodStart && loaded.statement.periodEnd
    ? months.filter((m) => {
        const end = addMonths(m, 1);
        return loaded.statement.periodStart! > m || loaded.statement.periodEnd! < addDays(end, -1);
      })
    : [];
  const clashes = rows.filter((r) => typedClash(r) !== null).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link to="/settings">
          <ArrowLeft /> Settings
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <CreditCard className="h-5 w-5" aria-hidden /> Import Amex statement
          </CardTitle>
          <CardDescription>
            On americanexpress.com go to Statements &amp; Activity, pick the statement, and choose Download → Excel
            (CSV works too). Each charge is filed under a line item and added on top of what you've typed. Nothing you
            typed is overwritten. Charges land in the month they were made, so a statement can cover two months.
            Uploading the same statement again only adds charges that aren't in yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-[var(--color-input)] p-6 text-sm hover:bg-[var(--color-accent)]">
            <Upload className="h-4 w-4" />
            {busy && !loaded ? "Reading…" : loaded?.fileName || "Choose the Amex .xlsx or .csv file"}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <FormError>{error}</FormError>
          {done && (
            <FormSuccess>
              Imported {done.count} card {done.count === 1 ? "charge" : "charges"}
              {done.oneOffs > 0 && ` and created ${done.oneOffs} one-off${done.oneOffs === 1 ? "" : "s"}`}. Open{" "}
              {done.months.map((m, i) => (
                <span key={m}>
                  {i > 0 && (i === done.months.length - 1 ? " and " : ", ")}
                  <Link className="underline" to={`/month/${monthSlug(m)}`}>
                    {formatMonth(m)}
                  </Link>
                </span>
              ))}
              .
            </FormSuccess>
          )}
        </CardContent>
      </Card>

      {loaded && (
        <>
          <Card>
            <CardContent className="space-y-3 p-4 text-sm">
              <p className="font-medium">
                {loaded.statement.accountLabel ?? "Amex"}
                {loaded.statement.periodStart && loaded.statement.periodEnd && (
                  <span className="font-normal text-[var(--color-muted-foreground)]">
                    {" "}
                    · {formatDay(loaded.statement.periodStart)}/{loaded.statement.periodStart.slice(0, 4)} to{" "}
                    {formatDay(loaded.statement.periodEnd)}/{loaded.statement.periodEnd.slice(0, 4)}
                  </span>
                )}
              </p>
              <ul className="space-y-1">
                <li className="flex items-center gap-2">
                  {totalsMatch === false ? (
                    <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" aria-hidden />
                  ) : (
                    <Check className="h-4 w-4 text-[var(--color-success)]" aria-hidden />
                  )}
                  {loaded.statement.rows.length} transactions: {formatMoney(parsedCharges, true)} charges,{" "}
                  {formatMoney(parsedCredits, true)} payments and credits
                  {totalsMatch === true && ", matching the statement summary"}
                  {totalsMatch === false &&
                    summary &&
                    `. The statement summary says ${formatMoney(summary.charges, true)} and ${formatMoney(summary.credits, true)}, so some rows may not have been read.`}
                </li>
                {loaded.alreadyImported > 0 && (
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-[var(--color-success)]" aria-hidden />
                    {loaded.alreadyImported} already imported, skipped
                  </li>
                )}
                {partial.length > 0 && (
                  <li className="flex items-center gap-2 text-[var(--color-muted-foreground)]">
                    <CreditCard className="h-4 w-4" aria-hidden />
                    {partial.map((m) => formatMonth(m)).join(" and ")} {partial.length === 1 ? "is" : "are"} only partly on
                    this statement. The rest comes with the {partial.length === 1 ? "next or previous" : "neighboring"}{" "}
                    statement.
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>

          {rows.length === 0 ? (
            <p className="text-center text-[var(--color-muted-foreground)]">Everything on this statement is already imported.</p>
          ) : (
            <>
              <Card>
                <CardContent className="space-y-2 p-4 text-sm">
                  {byMonth.map((m) => (
                    <p key={m.month}>
                      <span className="font-medium">{formatMonth(m.month)}:</span> adds {formatMoney(m.total, true)} across{" "}
                      {m.lines} line {m.lines === 1 ? "item" : "items"}
                      {m.unfiled > 0 && (
                        <span className="text-[var(--color-warning)]">
                          {" "}
                          + {formatMoney(m.unfiledTotal, true)} uncategorized ({m.unfiled})
                        </span>
                      )}
                      {m.oneOffs > 0 && ` · ${m.oneOffs} new one-off${m.oneOffs === 1 ? "" : "s"}`}
                      {m.covered > 0 && ` · ${formatMoney(m.covered, true)} already entered as one-offs`}
                    </p>
                  ))}
                  {clashes > 0 && (
                    <p className="flex items-start gap-2 text-[var(--color-warning)]">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      {clashes} {clashes === 1 ? "charge goes" : "charges go"} to a line that already has a typed amount
                      that month. Card charges add on top, so if the typed amount was the same bill, choose “Don't count”
                      here or clear the typed amount afterwards.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
                  <h2 className="flex-1 font-semibold">
                    {rows.length} new {rows.length === 1 ? "charge" : "charges"}
                  </h2>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} />
                    Needs attention only
                  </label>
                  {members.length > 1 && (
                    <Select className="h-9 w-44" value={member} onChange={(e) => setMember(e.target.value)} aria-label="Card member">
                      <option value="">Everyone</option>
                      {members.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
                <ul className="divide-y divide-[var(--color-border)]">
                  {visible.map((r) => {
                    const clash = typedClash(r);
                    const linkedOneOff = r.value.startsWith("oneoff:") ? oneOffById.get(r.value.slice(7)) : undefined;
                    const canBeOneOff = r.row.amount > 0 && r.value !== EXCLUDE && !linkedOneOff;
                    return (
                      <li key={r.row.externalId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
                        <div className="min-w-0 flex-1 basis-56">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate font-medium">{r.row.merchant}</span>
                            <span className={cn("tabular-nums", r.row.amount < 0 && "text-[var(--color-success)]")}>
                              {formatMoney(r.row.amount, true)}
                            </span>
                          </div>
                          <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                            {[
                              formatDay(r.row.postedOn),
                              r.row.cardMember,
                              r.row.sourceCategory ?? r.row.description,
                              !r.touched && REASON_LABEL[r.reason],
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <DestinationSelect
                          value={r.value}
                          onChange={(v) => setValue(r, v)}
                          categories={loaded.categories}
                          items={loaded.items}
                          oneOffs={loaded.oneOffs.filter((o) => o.month === r.row.month)}
                          className="w-full sm:w-56"
                          aria-label={`Where ${r.row.merchant} on ${formatDay(r.row.postedOn)} goes`}
                        />
                        <label
                          className={cn("flex w-24 items-center gap-1.5 text-xs", !canBeOneOff && "invisible")}
                          title={`Show it with big purchases. One-off per merchant per month, filed under the line item you picked${r.value ? "" : " (or uncategorized)"}.`}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={canBeOneOff && r.makeOneOff}
                            disabled={!canBeOneOff}
                            onChange={(e) => setOneOff(r, e.target.checked)}
                          />
                          One-off
                        </label>
                        {clash !== null && (
                          <p className="flex w-full items-center justify-end gap-1 text-xs text-[var(--color-warning)]">
                            <AlertTriangle className="h-3 w-3" aria-hidden />
                            {formatMoney(clash, true)} is already typed for {itemById.get(r.value)?.name} in{" "}
                            {formatMonth(r.row.month, "short")}. This charge adds on top.
                          </p>
                        )}
                        {linkedOneOff && (
                          <p className="w-full text-right text-xs text-[var(--color-muted-foreground)]">
                            Counted through the one-off “{linkedOneOff.name}” ({formatMoney(linkedOneOff.amount, true)}),
                            not again.
                          </p>
                        )}
                      </li>
                    );
                  })}
                  {visible.length === 0 && (
                    <li className="px-4 py-6 text-center text-sm text-[var(--color-muted-foreground)]">Nothing needs attention.</li>
                  )}
                </ul>
                <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] px-4 py-3">
                  <label className="flex flex-1 items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                    Remember the changes I made for these merchants next time
                  </label>
                  <Button onClick={handleImport} disabled={busy}>
                    {busy ? "Importing…" : `Import ${rows.length} ${rows.length === 1 ? "charge" : "charges"}`}
                  </Button>
                </div>
              </Card>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Charges of {formatMoney(ONE_OFF_THRESHOLD)} or more start out marked as one-offs. Uncategorized
                charges still count as spending. You can file them later from the Month page.
              </p>
            </>
          )}
        </>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Past imports</CardTitle>
          <CardDescription>Undo removes that statement's charges and any one-offs made from them.</CardDescription>
        </CardHeader>
        <CardContent>
          <FormError>{historyError}</FormError>
          {history.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">No statements imported yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {history.map((imp) => (
                <li key={imp.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {imp.period_start && imp.period_end
                        ? `${formatDay(imp.period_start)}/${imp.period_start.slice(2, 4)} – ${formatDay(imp.period_end)}/${imp.period_end.slice(2, 4)}`
                        : imp.file_name}
                    </p>
                    <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                      {imp.account_label ?? "Amex"} · {imp.row_count} charges · imported{" "}
                      {new Date(imp.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="tabular-nums">{formatMoney(imp.total, true)}</span>
                  <Button variant="ghost" size="sm" onClick={() => handleUndo(imp)} aria-label={`Undo import ${imp.file_name ?? ""}`}>
                    <Undo2 /> Undo
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** "2026-10-01", -1 → "2026-09-30" */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
