import { PiggyBank } from "lucide-react";
import { cn } from "@/lib/utils";

/** Budgeto logo: piggy bank tile plus the serif wordmark. */
export function BrandMark({ size = "md", showName = true, className }: { size?: "md" | "lg"; showName?: boolean; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-xl bg-[var(--color-primary)] text-[var(--color-primary-foreground)] shadow-sm",
          size === "lg" ? "h-12 w-12 rounded-2xl" : "h-9 w-9"
        )}
      >
        <PiggyBank className={size === "lg" ? "h-7 w-7" : "h-5 w-5"} aria-hidden />
      </span>
      {showName && (
        <span
          className={cn(
            "font-display font-semibold tracking-tight",
            size === "lg" ? "text-3xl" : "text-xl"
          )}
        >
          Budgeto
        </span>
      )}
    </span>
  );
}
