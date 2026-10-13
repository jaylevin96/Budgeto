import { Link, useLocation, useNavigate } from "react-router-dom";
import { CalendarDays, LayoutDashboard, LogOut, Moon, Settings, Sheet, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/hooks/useTheme";
import { currentMonthKey, monthSlug } from "@/lib/budget";
import { cn } from "@/lib/utils";

export function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const thisMonth = currentMonthKey();

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }

  const links = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, active: pathname === "/" },
    { to: `/month/${monthSlug(thisMonth)}`, label: "Month", icon: CalendarDays, active: pathname.startsWith("/month") },
    { to: `/year/${thisMonth.slice(0, 4)}`, label: "Year", icon: Sheet, active: pathname.startsWith("/year") },
    { to: "/settings", label: "Settings", icon: Settings, active: pathname.startsWith("/settings") || pathname.startsWith("/import") },
  ];

  const themeLabel = theme === "dark" ? "Light mode" : "Dark mode";
  const ThemeIcon = theme === "dark" ? Sun : Moon;

  return (
    <div className="min-h-svh bg-[var(--color-background)] lg:grid lg:grid-cols-[15rem_1fr]">
      {/* Desktop: sidebar */}
      <aside className="sticky top-0 hidden h-svh flex-col border-r border-[var(--color-border)] bg-[var(--color-card)] px-4 py-6 lg:flex">
        <Link to="/" className="px-2 text-[var(--color-foreground)]">
          <BrandMark />
        </Link>
        <nav className="mt-8 flex flex-col gap-1" aria-label="Main">
          {links.map(({ to, label, icon: Icon, active }) => (
            <Link
              key={label}
              to={to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                active
                  ? "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]"
                  : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-1 border-t border-[var(--color-border)] pt-4">
          <button type="button" onClick={toggleTheme} className={sidebarActionClass}>
            <ThemeIcon className="h-[18px] w-[18px]" aria-hidden />
            {themeLabel}
          </button>
          <button type="button" onClick={handleSignOut} className={sidebarActionClass}>
            <LogOut className="h-[18px] w-[18px]" aria-hidden />
            Sign out
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        {/* Mobile: slim top bar */}
        <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-background)]/90 pt-[env(safe-area-inset-top,0px)] backdrop-blur lg:hidden">
          <div className="flex h-14 items-center gap-2 px-4">
            <Link to="/" className="mr-auto text-[var(--color-foreground)]">
              <BrandMark />
            </Link>
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={`Switch to ${themeLabel.toLowerCase()}`}>
              <ThemeIcon className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      </div>

      {/* Mobile: bottom tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-card)]/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur lg:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-4 px-2">
          {links.map(({ to, label, icon: Icon, active }) => (
            <Link
              key={label}
              to={to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-1 py-2 text-[11px] font-semibold",
                active ? "text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]"
              )}
            >
              <span
                className={cn(
                  "grid h-8 w-14 place-items-center rounded-full transition-colors",
                  active && "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]"
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

const sidebarActionClass =
  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]";
