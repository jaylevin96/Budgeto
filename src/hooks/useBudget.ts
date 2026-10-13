import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildLedger,
  fetchAmounts,
  fetchOneOffs,
  fetchStructure,
  type Category,
  type LineItem,
  type MonthlyAmount,
  type OneOff,
} from "@/lib/budget";
import { fetchTransactions, type Transaction } from "@/lib/transactions";

type State = {
  categories: Category[];
  items: LineItem[];
  amounts: MonthlyAmount[];
  oneOffs: OneOff[];
  /** Card transactions, including excluded and one-off-covered ones */
  transactions: Transaction[];
  loading: boolean;
  error: string | null;
};

/** Load the budget structure plus amounts and one-offs for months in [fromKey, toKeyExclusive). */
export function useBudget(fromKey: string, toKeyExclusive: string) {
  const [state, setState] = useState<State>({
    categories: [],
    items: [],
    amounts: [],
    oneOffs: [],
    transactions: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [structure, amounts, oneOffs, transactions] = await Promise.all([
        fetchStructure(),
        fetchAmounts(fromKey, toKeyExclusive),
        fetchOneOffs(fromKey, toKeyExclusive),
        fetchTransactions(fromKey, toKeyExclusive),
      ]);
      setState({ ...structure, amounts, oneOffs, transactions, loading: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : "Failed to load" }));
    }
  }, [fromKey, toKeyExclusive]);

  useEffect(() => {
    load();
  }, [load]);

  /** Apply a saved (or deleted, when null) cell locally without refetching. */
  const applyAmount = useCallback((lineItemId: string, month: string, saved: MonthlyAmount | null) => {
    setState((s) => {
      const rest = s.amounts.filter((a) => !(a.line_item_id === lineItemId && a.month === month));
      return { ...s, amounts: saved ? [...rest, saved] : rest };
    });
  }, []);

  const applyAmounts = useCallback((saved: MonthlyAmount[]) => {
    setState((s) => {
      const keys = new Set(saved.map((a) => `${a.line_item_id}|${a.month}`));
      return { ...s, amounts: [...s.amounts.filter((a) => !keys.has(`${a.line_item_id}|${a.month}`)), ...saved] };
    });
  }, []);

  /** Apply a saved one-off, or remove it when `saved` is null. */
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

  const applyTransactions = useCallback((saved: Transaction[]) => {
    setState((s) => {
      const byId = new Map(saved.map((t) => [t.id, t]));
      return { ...s, transactions: s.transactions.map((t) => byId.get(t.id) ?? t) };
    });
  }, []);

  const ledger = useMemo(
    () => buildLedger(state.categories, state.items, state.amounts, state.oneOffs, state.transactions),
    [state.categories, state.items, state.amounts, state.oneOffs, state.transactions]
  );

  return { ...state, ledger, reload: load, applyAmount, applyAmounts, applyOneOff, applyTransactions };
}
