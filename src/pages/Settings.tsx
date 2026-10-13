import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, CreditCard, FileSpreadsheet, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { EmptyBudget } from "@/components/EmptyBudget";
import { supabase } from "@/lib/supabase";
import {
  fetchStructure,
  formatMoney,
  KIND_LABEL,
  parseAmount,
  RECURRENCE_LABEL,
  type Category,
  type CategoryKind,
  type LineItem,
  type Recurrence,
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
          <h1 className="text-2xl font-semibold">Categories &amp; line items</h1>
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
                    <div className="text-xs text-[var(--color-muted-foreground)]">
                      {RECURRENCE_LABEL[item.recurrence]}
                      {item.recurrence === "fixed" && item.default_amount != null &&
                        ` · ${formatMoney(item.default_amount, true)}`}
                      {item.monthly_budget != null && ` · Budget ${formatMoney(item.monthly_budget)}/mo`}
                    </div>
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

function CategoryDialog({
  category,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  category: Category | null;
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? "expense");
  const [archived, setArchived] = useState(category?.archived ?? false);
  const [budgetText, setBudgetText] = useState(category?.monthly_budget != null ? String(category.monthly_budget) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required");
    const budget = parseAmount(budgetText);
    if (Number.isNaN(budget)) return setError("Budget must be a number like 600 or 75.50");
    setBusy(true);
    setError(null);
    const row = { name: name.trim(), kind, archived, monthly_budget: kind === "income" ? null : budget };
    const { error: err } = category
      ? await supabase.from("categories").update(row).eq("id", category.id)
      : await supabase.from("categories").insert({ ...row, sort_order: nextSortOrder });
    setBusy(false);
    if (err) return setError(err.code === "23505" ? "A category with that name already exists" : err.message);
    onSaved();
  }

  async function handleDelete() {
    if (!category) return;
    if (
      !window.confirm(
        `Delete "${category.name}" and ALL of its line items and every amount ever entered for them? Its one-off purchases are kept as uncategorized. Archive it instead to keep history.`
      )
    )
      return;
    setBusy(true);
    const { error: err } = await supabase.from("categories").delete().eq("id", category.id);
    setBusy(false);
    if (err) return setError(err.message);
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? "Edit category" : "New category"}</DialogTitle>
          <DialogDescription>
            Savings categories (401k, HSA) are tracked separately from spending.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cat-name">Name</Label>
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cat-kind">Type</Label>
            <Select id="cat-kind" value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
              <option value="income">Income</option>
              <option value="expense">Spending</option>
              <option value="savings">Savings</option>
            </Select>
          </div>
          {kind !== "income" && (
            <BudgetField id="cat-budget" value={budgetText} onChange={setBudgetText} />
          )}
          {category && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
              Archived (hidden from entry, history kept)
            </label>
          )}
          <FormError>{error}</FormError>
          <DialogFooter className="gap-2">
            {category && (
              <Button type="button" variant="destructive" className="sm:mr-auto" onClick={handleDelete} disabled={busy}>
                Delete
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ItemDialog({
  item,
  categoryId,
  categories,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  item: LineItem | null;
  categoryId: string;
  categories: Category[];
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [catId, setCatId] = useState(item?.category_id ?? categoryId);
  const [recurrence, setRecurrence] = useState<Recurrence>(item?.recurrence ?? "none");
  const [amountText, setAmountText] = useState(item?.default_amount != null ? String(item.default_amount) : "");
  const [archived, setArchived] = useState(item?.archived ?? false);
  const [budgetText, setBudgetText] = useState(item?.monthly_budget != null ? String(item.monthly_budget) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required");
    const amount = parseAmount(amountText);
    if (Number.isNaN(amount)) return setError("Usual amount must be a number like 4700 or 85.50");
    if (recurrence === "fixed" && amount === null) return setError("Fixed items need a usual amount");
    const budget = parseAmount(budgetText);
    if (Number.isNaN(budget)) return setError("Budget must be a number like 600 or 75.50");
    setBusy(true);
    setError(null);
    const row = {
      name: name.trim(),
      category_id: catId,
      recurrence,
      default_amount: recurrence === "none" ? null : amount,
      monthly_budget: budget,
      archived,
    };
    const { error: err } = item
      ? await supabase.from("line_items").update(row).eq("id", item.id)
      : await supabase.from("line_items").insert({ ...row, sort_order: nextSortOrder });
    setBusy(false);
    if (err) return setError(err.code === "23505" ? "That category already has an item with this name" : err.message);
    onSaved();
  }

  async function handleDelete() {
    if (!item) return;
    if (!window.confirm(`Delete "${item.name}" and every amount entered for it? Its one-off purchases stay in the category. Archive it instead to keep history.`)) return;
    setBusy(true);
    const { error: err } = await supabase.from("line_items").delete().eq("id", item.id);
    setBusy(false);
    if (err) return setError(err.message);
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Edit line item" : "New line item"}</DialogTitle>
          <DialogDescription>How often it shows up decides what the Month page pre-fills.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="item-name">Name</Label>
            <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-cat">Category</Label>
            <Select id="item-cat" value={catId} onChange={(e) => setCatId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-rec">How often</Label>
            <Select id="item-rec" value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
              <option value="fixed">{RECURRENCE_LABEL.fixed} (rent, wages, 401k)</option>
              <option value="variable">{RECURRENCE_LABEL.variable} (utilities, groceries)</option>
              <option value="none">{RECURRENCE_LABEL.none} (vacations, gifts)</option>
            </Select>
          </div>
          {recurrence !== "none" && (
            <div className="space-y-2">
              <Label htmlFor="item-amt">
                Usual amount {recurrence === "variable" && <span className="font-normal">(optional; last month is used)</span>}
              </Label>
              <Input
                id="item-amt"
                inputMode="decimal"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                placeholder="0.00"
              />
            </div>
          )}
          <BudgetField id="item-budget" value={budgetText} onChange={setBudgetText} />
          {item && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
              Archived (hidden from entry, history kept)
            </label>
          )}
          <FormError>{error}</FormError>
          <DialogFooter className="gap-2">
            {item && (
              <Button type="button" variant="destructive" className="sm:mr-auto" onClick={handleDelete} disabled={busy}>
                Delete
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BudgetField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        Monthly budget <span className="font-normal">(optional)</span>
      </Label>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="No budget" />
    </div>
  );
}
