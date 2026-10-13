import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search as SearchIcon, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SearchResults } from "@/components/SearchResults";
import { addMonths, currentMonthKey, fetchStructure, type Category, type CreatedStructure, type LineItem, type OneOff } from "@/lib/budget";
import { isSearchable, searchAll, type SearchResult } from "@/lib/search";
import type { Transaction } from "@/lib/transactions";

const DEBOUNCE_MS = 300;

/** Range choices: all time, the last 12 months, or a calendar year */
function rangeOptions(): { value: string; label: string }[] {
  const year = Number(currentMonthKey().slice(0, 4));
  return [
    { value: "all", label: "All time" },
    { value: "12m", label: "Last 12 months" },
    ...Array.from({ length: 5 }, (_, i) => ({ value: String(year - i), label: String(year - i) })),
  ];
}

function rangeKeys(range: string): { fromKey?: string; toKeyExclusive?: string } {
  if (range === "12m") {
    const now = currentMonthKey();
    return { fromKey: addMonths(now, -11), toKeyExclusive: addMonths(now, 1) };
  }
  if (/^\d{4}$/.test(range)) return { fromKey: `${range}-01-01`, toKeyExclusive: `${Number(range) + 1}-01-01` };
  return {};
}

/** Search card charges and manual entries across every month, and refile them from the results. */
export function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const range = params.get("range") ?? "all";
  const [input, setInput] = useState(q);
  const [structure, setStructure] = useState<{ categories: Category[]; items: LineItem[] }>({ categories: [], items: [] });
  const [result, setResult] = useState<(SearchResult & { key: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = (next: { q?: string; range?: string }) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v && !(k === "range" && v === "all")) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };

  // Typing updates the URL (and so the search) once it pauses
  useEffect(() => {
    if (input.trim() === q) return;
    const t = setTimeout(() => update({ q: input.trim() }), DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  useEffect(() => {
    fetchStructure()
      .then(setStructure)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load categories"));
  }, []);

  const searchKey = `${range}|${q}`;
  useEffect(() => {
    if (!isSearchable(q)) return;
    let current = true;
    setError(null);
    searchAll(q, rangeKeys(range))
      .then((r) => current && setResult({ ...r, key: searchKey }))
      .catch((err) => current && setError(err instanceof Error ? err.message : "Search failed"));
    // A newer search replaces this one; drop its response
    return () => {
      current = false;
    };
  }, [q, range, searchKey]);

  const searchable = isSearchable(q);
  const loading = searchable && result?.key !== searchKey && !error;
  const shown = searchable && result?.key === searchKey ? result : null;

  const applyTransactions = (saved: Transaction[]) =>
    setResult((r) => {
      if (!r) return r;
      const byId = new Map(saved.map((t) => [t.id, t]));
      return { ...r, rows: r.rows.map((row) => (row.kind === "card" && byId.has(row.tx.id) ? { kind: "card", tx: byId.get(row.tx.id)! } : row)) };
    });

  const applyOneOff = (id: string, saved: OneOff) =>
    setResult((r) =>
      r && {
        ...r,
        rows: r.rows.map((row) => (row.kind === "manual" && row.oneOff.id === id ? { kind: "manual", oneOff: saved } : row)),
        linkedOneOffs: r.linkedOneOffs.map((o) => (o.id === id ? saved : o)),
      }
    );

  const applyCreated = ({ category, item }: CreatedStructure) =>
    setStructure((s) => ({
      categories: category ? [...s.categories, category] : s.categories,
      items: [...s.items, item],
    }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Find card charges and manual entries by merchant, name, note or amount, and change where they're filed.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-0 flex-1 basis-64">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]"
            aria-hidden
          />
          <Input
            type="search"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && update({ q: input.trim() })}
            placeholder="e.g. Whole Foods, rent, 42.50"
            aria-label="Search transactions"
            className="pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {input && (
            <button
              type="button"
              onClick={() => {
                setInput("");
                update({ q: "" });
              }}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Select value={range} onChange={(e) => update({ range: e.target.value })} className="w-auto" aria-label="Time range">
          {rangeOptions().map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {error && <FormError>{error}</FormError>}

      {!searchable ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Type at least two characters, or an amount.</p>
      ) : loading ? (
        <p className="text-[var(--color-muted-foreground)]">Searching…</p>
      ) : shown && shown.rows.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Nothing matches “{q}”.</p>
      ) : shown ? (
        <Card className="p-2 sm:p-3">
          {shown.truncated && (
            <p className="px-2 pb-2 text-sm text-[var(--color-warning)]">
              Showing the most recent matches only. Narrow the search or pick a time range to see the rest.
            </p>
          )}
          <SearchResults
            rows={shown.rows}
            categories={structure.categories}
            items={structure.items}
            oneOffs={shown.linkedOneOffs}
            showMonth
            onTransactionsSaved={applyTransactions}
            onOneOffSaved={applyOneOff}
            onCreated={applyCreated}
          />
        </Card>
      ) : null}
    </div>
  );
}
