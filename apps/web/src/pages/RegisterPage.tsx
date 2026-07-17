import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { signUp } from "../lib/auth";

export function RegisterPage() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    // Der Invite-Code ist kein von Better Auth verwaltetes Feld (siehe
    // apps/api/src/auth/auth.ts: hooks.before liest ctx.body.inviteCode direkt
    // aus), daher nicht Teil des ersten Arguments (das nur bekannte
    // sign-up/email-Felder typisiert), sondern via zweitem Argument
    // `{ body: { inviteCode } }` – createDynamicPathProxy merged dieses
    // `body` in den tatsächlichen Request-Body hinein (siehe
    // node_modules/better-auth/dist/client/proxy.mjs).
    const { error: signUpError } = await signUp.email(
      { email, password, name: displayName },
      { body: { inviteCode: inviteCode.trim() || undefined } },
    );

    setSubmitting(false);
    if (signUpError) {
      setError(signUpError.message ?? "Registrierung fehlgeschlagen.");
      return;
    }

    void navigate("/", { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6 py-12">
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
            Konto erstellen
          </h1>
          <p className="mb-6 text-center text-sm text-on-surface-muted">
            Ascent ist privat – die Registrierung erfordert einen Einladungscode.
          </p>

          <form className="flex flex-col gap-5" onSubmit={(event) => void handleSubmit(event)}>
            <div className="flex flex-col gap-2">
              <label
                htmlFor="displayName"
                className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
              >
                Name
              </label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                required
                autoComplete="name"
                placeholder="Max Mustermann"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="h-12 rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface placeholder:text-on-surface-muted/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

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
              <label
                htmlFor="password"
                className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
              >
                Passwort
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="Mindestens 8 Zeichen"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-12 rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface placeholder:text-on-surface-muted/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="inviteCode"
                className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
              >
                Einladungscode
              </label>
              <input
                id="inviteCode"
                name="inviteCode"
                type="text"
                autoComplete="off"
                placeholder="z. B. AB12CD34EF56"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                className="h-12 rounded-md border-0 border-b-2 border-outline bg-surface px-4 uppercase tracking-widest text-on-surface placeholder:text-on-surface-muted/60 placeholder:normal-case placeholder:tracking-normal focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="text-xs text-on-surface-muted">
                Nur das allererste Konto benötigt keinen Einladungscode.
              </p>
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
              {submitting ? "Wird erstellt…" : "Konto erstellen"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-on-surface-muted">
            Bereits ein Konto?{" "}
            <Link to="/login" className="font-semibold text-primary hover:underline">
              Jetzt anmelden
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
