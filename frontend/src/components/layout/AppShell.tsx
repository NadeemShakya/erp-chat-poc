import * as React from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";

export default function AppShell() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "rounded-xl px-3 py-2 text-sm transition-colors",
      isActive
        ? "bg-muted font-medium text-foreground"
        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
    );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between p-4">
          <Link to="/chat" className="text-sm font-semibold">
            ERP Chat POC
          </Link>

          <nav className="flex items-center gap-2">
            <NavLink to="/chat" className={linkClass}>
              Chat
            </NavLink>
            <NavLink to="/settings" className={linkClass}>
              Settings
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
