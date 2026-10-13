import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildLedger,
  fetchOneOffs,
  fetchStructure,
  type Category,
  type CreatedStructure,
  type LineItem,
  type OneOff,
} from "@/lib/budget";
import { ensureOccurrences, fetchRecurring, type RecurringEntry } from "@/lib/recurring";
import { fetchTransactions, type Transaction } from "@/lib/transactions";

type State = {
  categories: Category[];
  items: LineItem[];
  oneOffs: OneOff[];
  /** Every recurring entry (any month) */
  recurring: RecurringEntry[];
  /** Card transactions, including excluded and one-off-covered ones */
  transactions: Transaction[];
  loading: boolean;
  error: string | null;
};

/** Load the budget structure plus manual entries and card charges for months in [fromKey, toKeyExclusive). */
export function useBudget(fromKey: string, toKeyExclusive: string) {
  const [state, setState] = useState<State>({
    categories: [],
    items: [],
    oneOffs: [],
    recurring: [],
    transactions: [],
    loading: true,
    error: null,
  });

  /** `quiet` refetches without showing the loading state (after edits that touch many rows) */
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      // Recurring entries first: create any months they're due for, so the entries below include them
      const recurring = await fetchRecurring();
      await ensureOccurrences(recurring);
      const [structure, oneOffs, transactions] = await Promise.all([
        fetchStructure(),
        fetchOneOffs(fromKey, toKeyExclusive),
        fetchTransactions(fromKey, toKeyExclusive),
      ]);
      setState({ ...structure, oneOffs, recurring, transactions, loading: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : "Failed to load" }));
    }
  }, [fromKey, toKeyExclusive]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  /** Apply a saved manual entry, or remove it when `saved` is null. */
  const applyOneOff = useCallback((id: string, saved: OneOff | null) => {
    setState((s) => {
      const rest = s.oneOffs.filter((o) => o.id !== id);
      return {
        ...s,
        oneOffs: saved ? [...rest, saved] : rest,
        // Deleting a one-off frees the card charges it covered (the database does the same)
        transactions: saved ? s.transactions : s.transactions.map((t) => (t.one_off_id === id ? { ...t, one_off_id: null } : t)),
      };
    });
  }, []);

  const applyOneOffs = useCallback((saved: OneOff[]) => {
    setState((s) => ({ ...s, oneOffs: [...s.oneOffs, ...saved] }));
  }, []);

  /** Add a line item (and its new category) created elsewhere, e.g. while filing a card charge. */
  const applyCreated = useCallback(({ category, item }: CreatedStructure) => {
    setState((s) => ({
      ...s,
      categories: category ? [...s.categories, category] : s.categories,
      items: [...s.items, item],
    }));
  }, []);

  const applyTransactions = useCallback((saved: Transaction[]) => {
    setState((s) => {
      const byId = new Map(saved.map((t) => [t.id, t]));
      return { ...s, transactions: s.transactions.map((t) => byId.get(t.id) ?? t) };
    });
  }, []);

  const ledger = useMemo(
    () => buildLedger(state.categories, state.items, state.oneOffs, state.transactions),
    [state.categories, state.items, state.oneOffs, state.transactions]
  );

  return { ...state, ledger, reload: load, refresh, applyOneOff, applyOneOffs, applyTransactions, applyCreated };
}
