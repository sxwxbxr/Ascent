import { NavLink, Outlet } from "react-router";

interface NavLinkState {
  isActive: boolean;
}

function getNavLinkClassName({ isActive }: NavLinkState): string {
  const base =
    "border-b-2 pb-1 text-xs font-semibold uppercase tracking-widest transition-colors";
  return isActive
    ? `${base} border-primary text-primary`
    : `${base} border-transparent text-on-surface-muted hover:text-on-surface`;
}

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-surface text-on-surface">
      <header className="sticky top-0 z-10 border-b border-outline/40 bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-6">
          <span className="text-lg font-extrabold tracking-wide text-white">
            ASCENT
          </span>
          <nav className="flex items-center gap-8">
            <NavLink to="/" end className={getNavLinkClassName}>
              Dashboard
            </NavLink>
            <NavLink to="/download" className={getNavLinkClassName}>
              App herunterladen
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}
