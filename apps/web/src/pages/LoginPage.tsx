import { useState } from "react";
import type { FormEvent } from "react";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Auth kommt in M1 – hier passiert bewusst noch nichts.
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="text-2xl font-extrabold tracking-wide text-white">
            ASCENT
          </span>
          <p className="mt-2 text-sm text-on-surface-muted">
            Entfessle dein Potenzial.
          </p>
        </div>

        <div className="rounded-lg border border-surface-container-high bg-surface-container p-8">
          <h1 className="mb-1 text-center text-2xl font-bold text-on-surface">
            Willkommen zurück
          </h1>
          <p className="mb-6 text-center text-sm text-on-surface-muted">
            Logge dich ein, um dein Training fortzusetzen.
          </p>

          <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <label
                htmlFor="email"
                className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
              >
                E-Mail-Adresse
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="athlet@ascent.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-12 rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface placeholder:text-on-surface-muted/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                >
                  Passwort
                </label>
                <a
                  href="#"
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Passwort vergessen?
                </a>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-12 rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface placeholder:text-on-surface-muted/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <button
              type="submit"
              className="mt-2 h-12 rounded-md bg-primary font-bold uppercase tracking-wide text-on-primary transition-opacity hover:opacity-90 active:scale-[0.98]"
            >
              Anmelden
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
