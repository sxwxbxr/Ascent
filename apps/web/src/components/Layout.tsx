import { NavLink, Navigate, Outlet } from "react-router";
import { EntitlementsProvider } from "../lib/entitlements";
import { SnapshotProvider } from "../lib/snapshot";
import { signOut, useSession } from "../lib/auth";

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

/**
 * Wurzel-Layout aller geschützten Seiten: prüft die Better-Auth-Session
 * (useSession) und leitet ohne Session auf /login um. Erst danach werden
 * Snapshot- (POST /sync/pull) und Entitlements-Provider gemountet, damit
 * diese nie anonym feuern.
 */
export function Layout() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <p className="text-sm text-on-surface-muted">Wird geladen…</p>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <SnapshotProvider>
      <EntitlementsProvider>
        <div className="flex min-h-screen flex-col bg-surface text-on-surface">
          <header className="sticky top-0 z-10 border-b border-outline/40 bg-surface">
            <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-6">
              <span className="text-lg font-extrabold tracking-wide text-white">
                ASCENT
              </span>
              <nav className="hidden items-center gap-8 md:flex">
                <NavLink to="/" end className={getNavLinkClassName}>
                  Dashboard
                </NavLink>
                <NavLink to="/verlauf" className={getNavLinkClassName}>
                  Verlauf
                </NavLink>
                <NavLink to="/plaene" className={getNavLinkClassName}>
                  Pläne
                </NavLink>
                <NavLink to="/uebungen" className={getNavLinkClassName}>
                  Übungen
                </NavLink>
                <NavLink to="/ernaehrung" className={getNavLinkClassName}>
                  Ernährung
                </NavLink>
                <NavLink to="/download" className={getNavLinkClassName}>
                  Download
                </NavLink>
                <NavLink to="/einstellungen" className={getNavLinkClassName}>
                  Einstellungen
                </NavLink>
              </nav>
              <button
                type="button"
                onClick={() => void signOut()}
                className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted transition-colors hover:text-error"
              >
                Abmelden
              </button>
            </div>
            <nav className="flex items-center gap-6 overflow-x-auto border-t border-outline/40 px-6 py-2 md:hidden">
              <NavLink to="/" end className={getNavLinkClassName}>
                Dashboard
              </NavLink>
              <NavLink to="/verlauf" className={getNavLinkClassName}>
                Verlauf
              </NavLink>
              <NavLink to="/plaene" className={getNavLinkClassName}>
                Pläne
              </NavLink>
              <NavLink to="/uebungen" className={getNavLinkClassName}>
                Übungen
              </NavLink>
              <NavLink to="/ernaehrung" className={getNavLinkClassName}>
                Ernährung
              </NavLink>
              <NavLink to="/download" className={getNavLinkClassName}>
                Download
              </NavLink>
              <NavLink to="/einstellungen" className={getNavLinkClassName}>
                Einstellungen
              </NavLink>
            </nav>
          </header>
          <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-10">
            <Outlet />
          </main>
        </div>
      </EntitlementsProvider>
    </SnapshotProvider>
  );
}
