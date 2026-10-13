import { useCallback, useState } from "react";
import { parseAmount, saveAmount, type MonthlyAmount } from "@/lib/budget";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Save logic for one cell (line item × month). Blank deletes the cell ("not entered"),
 * an unchanged value is a no-op, invalid input reports an error without saving.
 */
export function useCellSaver(
  lineItemId: string,
  month: string,
  value: number | undefined,
  onSaved: (saved: MonthlyAmount | null) => void
) {
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const commit = useCallback(
    async (raw: string): Promise<boolean> => {
      const parsed = parseAmount(raw);
      if (Number.isNaN(parsed)) {
        setState("error");
        setMessage("Enter a number like 125 or 125.40");
        return false;
      }
      if ((parsed ?? undefined) === value) {
        setState("idle");
        setMessage(null);
        return true;
      }
      setState("saving");
      setMessage(null);
      try {
        onSaved(await saveAmount(lineItemId, month, parsed));
        setState("saved");
        return true;
      } catch (err) {
        setState("error");
        setMessage(err instanceof Error ? err.message : "Could not save");
        return false;
      }
    },
    [lineItemId, month, value, onSaved]
  );

  const reset = useCallback(() => {
    setState("idle");
    setMessage(null);
  }, []);

  return { state, message, commit, reset };
}

export type CellSaver = ReturnType<typeof useCellSaver>;
