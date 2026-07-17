import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { signIn } from "../lib/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error: signInError } = await signIn.email({ email, password });

    setSubmitting(false);
    if (signInError) {
      setError(signInError.message ?? "Anmeldung fehlgeschlagen.");
      return;
    }

    void navigate("/", { replace: true });
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

          <form className="flex flex-col gap-5" onSubmit={(event) => void handleSubmit(event)}>
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

            {error && (
              <p role="alert" className="text-sm text-error">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 h-12 rounded-md bg-primary font-bold uppercase tracking-wide text-on-primary transition-opacity hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Wird angemeldet…" : "Anmelden"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-on-surface-muted">
            Noch kein Konto?{" "}
            <Link to="/register" className="font-semibold text-primary hover:underline">
              Jetzt registrieren
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
