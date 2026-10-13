import { Link } from "react-router-dom";
import { ChartColumn } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small icon link to a line item's or category's history page */
export function TrendLink({ kind, id, name, className }: { kind: "item" | "category"; id: string; name: string; className?: string }) {
  return (
    <Link
      to={kind === "item" ? `/items/${id}` : `/categories/${id}`}
      title={`${name} over time`}
      aria-label={`${name} over time`}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]",
        className
      )}
    >
      <ChartColumn className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}
