import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { CalendarDays, LayoutDashboard, LogOut, Moon, Settings, Sheet, ShoppingBag, Sun, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/hooks/useTheme";
import { currentMonthKey, monthSlug } from "@/lib/budget";
import { cn } from "@/lib/utils";

const navLinkClass =
  "flex h-11 min-w-[44px] items-center justify-center rounded-md text-sm font-medium text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-accent)] sm:h-auto sm:min-w-0 sm:justify-start sm:px-2 sm:py-1.5";

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
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: `/month/${monthSlug(thisMonth)}`, label: "Month", icon: CalendarDays, match: "/month" },
    { to: `/year/${thisMonth.slice(0, 4)}`, label: "Year", icon: Sheet, match: "/year" },
    { to: "/one-offs", label: "One-offs", icon: ShoppingBag, match: "/one-offs" },
    { to: "/settings", label: "Settings", icon: Settings, match: "/settings" },
  ];

  return (
    <div className="min-h-svh bg-[var(--color-background)]">
      <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-background)] pt-[env(safe-area-inset-top,0px)]">
        <div className="container mx-auto flex min-h-14 items-center gap-2 px-4 py-1 sm:gap-6 sm:py-0">
          <Link to="/" className="flex shrink-0 items-center gap-2 font-semibold text-[var(--color-foreground)]">
            <Wallet className="h-6 w-6 shrink-0" aria-hidden />
            <span className="hidden sm:inline">Budgeto</span>
          </Link>
          <nav className="flex min-w-0 flex-1 items-center justify-center gap-1 sm:justify-start sm:gap-2">
            {links.map(({ to, label, icon: Icon, end, match }) => (
              <NavLink
                key={label}
                to={to}
                end={end}
                aria-label={label}
                className={({ isActive }) =>
                  cn(
                    navLinkClass,
                    (match ? pathname.startsWith(match) : isActive) &&
                      "bg-[var(--color-accent)]"
                  )
                }
              >
                <Icon className="h-5 w-5 shrink-0 sm:mr-2 sm:h-4 sm:w-4" aria-hidden />
                <span className="hidden sm:inline">{label}</span>
              </NavLink>
            ))}
          </nav>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
