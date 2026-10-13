import { useCallback, useEffect, useState } from "react";
import {
  fetchAmounts,
  fetchStructure,
  type Category,
  type LineItem,
  type MonthlyAmount,
} from "@/lib/budget";

type State = {
  categories: Category[];
  items: LineItem[];
  amounts: MonthlyAmount[];
  loading: boolean;
  error: string | null;
};

/** Load the budget structure plus amounts for months in [fromKey, toKeyExclusive). */
export function useBudget(fromKey: string, toKeyExclusive: string) {
  const [state, setState] = useState<State>({ categories: [], items: [], amounts: [], loading: true, error: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [structure, amounts] = await Promise.all([fetchStructure(), fetchAmounts(fromKey, toKeyExclusive)]);
      setState({ ...structure, amounts, loading: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : "Failed to load" }));
    }
  }, [fromKey, toKeyExclusive]);

  useEffect(() => {
    load();
  }, [load]);

  /** Apply a saved (or deleted, when amount is null) cell locally without refetching. */
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

  return { ...state, reload: load, applyAmount, applyAmounts };
}
