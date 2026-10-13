import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, CreditCard, FileSpreadsheet, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-message";
import { EmptyBudget } from "@/components/EmptyBudget";
import { CategoryDialog, ItemDialog } from "@/components/StructureDialogs";
import { supabase } from "@/lib/supabase";
import {
  fetchStructure,
  formatMoney,
  KIND_LABEL,
  type Category,
  type LineItem,
} from "@/lib/budget";
import { cn } from "@/lib/utils";

type Editing =
  | { type: "category"; category: Category | null }
  | { type: "item"; item: LineItem | null; categoryId: string }
  | null;

export function Settings() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [showArchived, setShowArchived] = useState(false);

  async function load() {
    try {
      const s = await fetchStructure();
      setCategories(s.categories);
      setItems(s.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  /** Move a row up/down by renumbering its siblings. */
  async function move<T extends { id: string; sort_order: number }>(
    table: "categories" | "line_items",
    list: T[],
    id: string,
    dir: -1 | 1
  ) {
    const i = list.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const reordered = [...list];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    const updates = reordered
      .map((r, k) => ({ id: r.id, sort_order: (k + 1) * 10, changed: r.sort_order !== (k + 1) * 10 }))
      .filter((u) => u.changed);
    const results = await Promise.all(
      updates.map((u) => supabase.from(table).update({ sort_order: u.sort_order }).eq("id", u.id))
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) setError(failed.error.message);
    load();
  }

  if (!loading && !error && categories.length === 0) return <EmptyBudget onSeeded={load} />;

  const visibleCategories = categories.filter((c) => showArchived || !c.archived);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Categories &amp; line items</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            The rows of your budget. Recurring items are pre-filled on the Month page.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/import/card">
              <CreditCard /> Import Amex
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/settings/import">
              <FileSpreadsheet /> Import
            </Link>
          </Button>
          <Button size="sm" onClick={() => setEditing({ type: "category", category: null })}>
            <Plus /> Category
          </Button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Show archived
      </label>

      {error && <FormError>{error}</FormError>}
      {loading && <p className="text-[var(--color-muted-foreground)]">Loading…</p>}

      {visibleCategories.map((cat, ci) => {
        const catItems = items.filter((i) => i.category_id === cat.id);
        const visibleItems = catItems.filter((i) => showArchived || !i.archived);
        return (
          <Card key={cat.id} className={cn(cat.archived && "opacity-60")}>
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">
                  {cat.name}
                  {cat.archived && <span className="ml-2 text-xs font-normal">(archived)</span>}
                </h2>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {KIND_LABEL[cat.kind]}
                  {cat.monthly_budget != null && ` · Budget ${formatMoney(cat.monthly_budget)}/mo`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Move ${cat.name} up`}
                disabled={ci === 0}
                onClick={() => move("categories", visibleCategories, cat.id, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Move ${cat.name} down`}
                disabled={ci === visibleCategories.length - 1}
                onClick={() => move("categories", visibleCategories, cat.id, 1)}
              >
                <ArrowDown />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit ${cat.name}`}
                onClick={() => setEditing({ type: "category", category: cat })}
              >
                <Pencil />
              </Button>
            </div>
            <ul className="divide-y divide-[var(--color-border)]">
              {visibleItems.map((item, ii) => (
                <li key={item.id} className={cn("flex items-center gap-2 px-4 py-2", item.archived && "opacity-60")}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      {item.name}
                      {item.archived && <span className="ml-2 text-xs">(archived)</span>}
                    </div>
                    {item.monthly_budget != null && (
                      <div className="text-xs text-[var(--color-muted-foreground)]">
                        Budget {formatMoney(item.monthly_budget)}/mo
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${item.name} up`}
                    disabled={ii === 0}
                    onClick={() => move("line_items", visibleItems, item.id, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${item.name} down`}
                    disabled={ii === visibleItems.length - 1}
                    onClick={() => move("line_items", visibleItems, item.id, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${item.name}`}
                    onClick={() => setEditing({ type: "item", item, categoryId: item.category_id })}
                  >
                    <Pencil />
                  </Button>
                </li>
              ))}
              <li className="px-2 py-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing({ type: "item", item: null, categoryId: cat.id })}
                >
                  <Plus /> Add line item
                </Button>
              </li>
            </ul>
          </Card>
        );
      })}

      {editing?.type === "category" && (
        <CategoryDialog
          category={editing.category}
          nextSortOrder={(categories.length + 1) * 10}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {editing?.type === "item" && (
        <ItemDialog
          item={editing.item}
          categoryId={editing.categoryId}
          categories={categories}
          nextSortOrder={(items.filter((i) => i.category_id === editing.categoryId).length + 1) * 10}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
