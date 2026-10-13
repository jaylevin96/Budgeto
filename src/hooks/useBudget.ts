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

type State = {
  categories: Category[];
  items: LineItem[];
  amounts: MonthlyAmount[];
  oneOffs: OneOff[];
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
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [structure, amounts, oneOffs] = await Promise.all([
        fetchStructure(),
        fetchAmounts(fromKey, toKeyExclusive),
        fetchOneOffs(fromKey, toKeyExclusive),
      ]);
      setState({ ...structure, amounts, oneOffs, loading: false, error: null });
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
      return { ...s, oneOffs: saved ? [...rest, saved] : rest };
    });
  }, []);

  const ledger = useMemo(
    () => buildLedger(state.categories, state.items, state.amounts, state.oneOffs),
    [state.categories, state.items, state.amounts, state.oneOffs]
  );

  return { ...state, ledger, reload: load, applyAmount, applyAmounts, applyOneOff };
}
