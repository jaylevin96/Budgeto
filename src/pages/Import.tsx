import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, FormSuccess } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyBudget, parseBudgetWorkbook, type ImportResult, type ParsedBudget } from "@/lib/importer";
import { formatMoney, KIND_LABEL, MONTH_SHORT, RECURRENCE_LABEL, sumMoney } from "@/lib/budget";
import { cn } from "@/lib/utils";

export function Import() {
  const [parsed, setParsed] = useState<ParsedBudget | null>(null);
  const [fileName, setFileName] = useState("");
  const [yearText, setYearText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFile(file: File | undefined) {
    setError(null);
    setResult(null);
    setParsed(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const p = await parseBudgetWorkbook(await file.arrayBuffer());
      if (!p.sections.length) {
        setError("Couldn't find any sections. Expected header rows like: HOME | JAN | FEB | … | DEC.");
        return;
      }
      setParsed(p);
      setYearText(p.year ? String(p.year) : String(new Date().getFullYear()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    }
  }

  async function handleImport() {
    if (!parsed) return;
    const year = Number(yearText);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      setError("Enter the year these amounts belong to");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await applyBudget(parsed.sections, year));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  // Preview totals computed the same way the app does
  const monthTotals = parsed
    ? MONTH_SHORT.map((_, m) => {
        const sum = (kind: string) =>
          sumMoney(
            parsed.sections
              .filter((s) => s.kind === kind)
              .flatMap((s) => s.items.map((i) => i.values[m] ?? 0))
          );
        const income = sum("income");
        const spending = sum("expense");
        const savings = sum("savings");
        return { income, spending, savings, net: sumMoney([income, -spending, -savings]) };
      })
    : [];
  const cellCount = parsed?.sections.reduce((n, s) => n + s.items.reduce((k, i) => k + i.values.filter((v) => v !== null).length, 0), 0) ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link to="/settings">
          <ArrowLeft /> Settings
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Import budget spreadsheet</CardTitle>
          <CardDescription>
            Upload the yearly budget workbook (.xlsx). Each section header row (e.g. <em>HOME | JAN | … | DEC</em>)
            becomes a category, each row a line item, and each filled cell a monthly amount. Totals rows are
            skipped and recalculated. Re-importing is safe: existing items are matched by name and amounts are
            overwritten with the spreadsheet's values.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-[var(--color-input)] p-6 text-sm hover:bg-[var(--color-accent)]">
            <Upload className="h-4 w-4" />
            {fileName || "Choose a .xlsx file"}
            <input
              type="file"
              accept=".xlsx,.xls"
              className="sr-only"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </label>
          <FormError>{error}</FormError>
          {result && (
            <FormSuccess>
              Imported {result.categoriesCreated} new categories, {result.itemsCreated} new line items and{" "}
              {result.amountsSaved} monthly amounts. <Link className="underline" to="/">Open the dashboard</Link>
            </FormSuccess>
          )}
        </CardContent>
      </Card>

      {parsed && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-end gap-4 p-4">
              <div className="space-y-2">
                <Label htmlFor="import-year">Year</Label>
                <Input id="import-year" className="w-28" value={yearText} onChange={(e) => setYearText(e.target.value)} />
              </div>
              <p className="flex-1 text-sm text-[var(--color-muted-foreground)]">
                {parsed.sections.length} categories ·{" "}
                {parsed.sections.reduce((n, s) => n + s.items.length, 0)} line items · {cellCount} monthly amounts
              </p>
              <Button onClick={handleImport} disabled={busy || !!result}>
                {busy ? "Importing…" : result ? "Imported" : "Import"}
              </Button>
            </CardContent>
          </Card>

          <Card className="overflow-x-auto">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Preview</CardTitle>
              <CardDescription>
                Check these totals against your spreadsheet. "Left over" is income minus spending and savings,
                calculated per month (the spreadsheet's Net Income row repeated the prior month's value in
                Feb, Apr, Jun, Aug, Oct and Dec).
              </CardDescription>
            </CardHeader>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-muted-foreground)]">
                  <th className="px-3 py-1.5 text-left font-medium">Item</th>
                  <th className="px-2 py-1.5 text-left font-medium">Repeats</th>
                  {MONTH_SHORT.map((m) => (
                    <th key={m} className="px-2 py-1.5 text-right font-medium">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.sections.map((s) => (
                  <PreviewSection key={s.name} section={s} />
                ))}
                {(
                  [
                    ["Total income", "income"],
                    ["Total spending", "spending"],
                    ["Total saved", "savings"],
                    ["Left over", "net"],
                  ] as const
                ).map(([label, key]) => (
                  <tr key={key} className={cn("border-t border-[var(--color-border)]", key === "net" && "font-semibold")}>
                    <td className="px-3 py-1.5 whitespace-nowrap" colSpan={2}>
                      {label}
                    </td>
                    {monthTotals.map((t, i) => (
                      <td key={i} className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                        {formatMoney(t[key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

function PreviewSection({ section }: { section: ParsedBudget["sections"][number] }) {
  return (
    <>
      <tr className="bg-[var(--color-muted)]">
        <th colSpan={14} className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide">
          {section.name}
          <span className="ml-2 font-normal normal-case tracking-normal text-[var(--color-muted-foreground)]">
            {KIND_LABEL[section.kind]}
          </span>
        </th>
      </tr>
      {section.items.map((item) => (
        <tr key={item.name} className="border-b border-[var(--color-border)]">
          <td className="px-3 py-1.5 whitespace-nowrap">{item.name}</td>
          <td className="px-2 py-1.5 text-xs whitespace-nowrap text-[var(--color-muted-foreground)]">
            {RECURRENCE_LABEL[item.recurrence]}
            {item.default_amount != null && ` · ${formatMoney(item.default_amount)}`}
          </td>
          {item.values.map((v, i) => (
            <td key={i} className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
              {v === null ? <span className="text-[var(--color-muted-foreground)]">·</span> : formatMoney(v)}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
