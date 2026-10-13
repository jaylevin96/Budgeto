import { BrandMark } from "@/components/BrandMark";

/** Split-screen frame for the signed-out pages: brand panel on wide screens, form on the right. */
export function AuthShell({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh bg-[var(--color-background)] lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-[var(--color-primary)] p-12 text-[var(--color-primary-foreground)] lg:flex lg:flex-col">
        <BrandMark className="[&>span:first-child]:bg-[var(--color-primary-foreground)] [&>span:first-child]:text-[var(--color-primary)]" />
        <div className="my-auto max-w-md">
          <p className="text-5xl leading-[1.05] font-bold tracking-tight">
            Know where every dollar went.
          </p>
          <p className="mt-5 text-lg opacity-80">
            Enter the month, watch the year take shape, and see what's left over for the household.
          </p>
        </div>
        <div aria-hidden className="pointer-events-none absolute -right-24 -bottom-24 h-80 w-80 rounded-full bg-current opacity-[0.07]" />
        <div aria-hidden className="pointer-events-none absolute right-24 bottom-40 h-32 w-32 rounded-full bg-current opacity-[0.05]" />
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <BrandMark size="lg" className="mb-8 lg:hidden" />
          <h1 className="text-3xl font-bold tracking-tight">{subtitle}</h1>
          <div className="mt-6">{children}</div>
        </div>
      </section>
    </div>
  );
}
