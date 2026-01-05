import { cn } from "@/lib/utils";
import { Link, NavLink, Outlet } from "react-router-dom";

function EnvBadge() {
  const mode = import.meta.env.MODE; // "development" | "production"
  const api = import.meta.env.VITE_API_BASE_URL || "";
  const label = mode === "development" ? "DEV" : "PROD";

  return (
    <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center rounded-full border px-2 py-0.5">
        {label}
      </span>
      {api ? (
        <span className="truncate max-w-[260px]">
          API: <span className="font-mono">{api}</span>
        </span>
      ) : null}
    </div>
  );
}

export default function AppShell() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "inline-flex items-center rounded-full px-3 py-1.5 text-sm transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      isActive
        ? "bg-primary/10 text-foreground ring-1 ring-primary/20"
        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
    );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          {/* Brand */}
          <Link to="/chat" className="flex items-center gap-3 min-w-0">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            </span>

            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-tight">
                ERP Chat POC
              </div>
              <div className="truncate text-xs text-muted-foreground">
                RAG • Agent-only • PDO • LangSmith traces
              </div>
            </div>
          </Link>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <EnvBadge />

            <nav className="flex items-center gap-2 rounded-full border bg-background px-2 py-1">
              <NavLink to="/chat" className={linkClass}>
                Chat
              </NavLink>
              <NavLink to="/settings" className={linkClass}>
                Settings
              </NavLink>
            </nav>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-4 md:px-6 md:py-6">
        <Outlet />
      </main>
    </div>
  );
}
