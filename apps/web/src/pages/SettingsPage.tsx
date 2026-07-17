import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Tier } from "@ascent/shared";
import { ApiError, api } from "../lib/api";
import { signOut } from "../lib/auth";
import { useEntitlements } from "../lib/entitlements";

type Gender = "m" | "w" | "d";

interface Profile {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  gender: Gender | null;
  birthDate: string | null;
  heightCm: number | null;
  goal: string | null;
  tier: Tier;
  createdAt: number;
  updatedAt: number;
}

interface ProfileUpdateBody {
  displayName: string;
  gender?: Gender;
  birthDate?: string;
  heightCm?: number;
  goal?: string;
}

interface ProfileFormState {
  displayName: string;
  gender: Gender | "";
  birthDate: string;
  heightCm: string;
  goal: string;
}

type InviteStatus = "offen" | "verwendet" | "abgelaufen";

interface Invite {
  code: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  status: InviteStatus;
}

const INVITE_STATUS_STYLES: Record<InviteStatus, string> = {
  offen: "bg-primary text-on-primary",
  verwendet: "bg-surface-container-high text-on-surface-muted",
  abgelaufen: "bg-surface-container-high text-error",
};

const TIER_LABELS: Record<Tier, string> = {
  free: "FREE",
  trial: "TRIAL",
  pro: "PRO",
};

function formToState(profile: Profile): ProfileFormState {
  return {
    displayName: profile.displayName,
    gender: profile.gender ?? "",
    birthDate: profile.birthDate ?? "",
    heightCm: profile.heightCm !== null ? String(profile.heightCm) : "",
    goal: profile.goal ?? "",
  };
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function InviteStatusBadge({ status }: { status: InviteStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${INVITE_STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

export function SettingsPage() {
  const { entitlements } = useEntitlements();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<ProfileFormState | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [newInviteCode, setNewInviteCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await api.get<Profile>("/profile");
        if (!cancelled) {
          setProfile(result);
          setForm(formToState(result));
        }
      } catch (err) {
        if (!cancelled) {
          setProfileError(errorMessage(err, "Profil konnte nicht geladen werden."));
        }
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await api.get<Invite[]>("/invites");
        if (!cancelled) setInvites(result);
      } catch (err) {
        if (!cancelled) {
          setInvitesError(errorMessage(err, "Einladungscodes konnten nicht geladen werden."));
        }
      } finally {
        if (!cancelled) setInvitesLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    const body: ProfileUpdateBody = { displayName: form.displayName };
    if (form.gender !== "") body.gender = form.gender;
    if (form.birthDate !== "") body.birthDate = form.birthDate;
    if (form.heightCm !== "") body.heightCm = Number(form.heightCm);
    if (form.goal !== "") body.goal = form.goal;

    try {
      const updated = await api.put<Profile>("/profile", body);
      setProfile(updated);
      setForm(formToState(updated));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      setSaveError(errorMessage(err, "Speichern fehlgeschlagen."));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateInvite() {
    setCreatingInvite(true);
    setInvitesError(null);

    try {
      const created = await api.post<{ code: string; expiresAt: number }>("/invites");
      setNewInviteCode(created.code);
      setCopied(false);
      const list = await api.get<Invite[]>("/invites");
      setInvites(list);
    } catch (err) {
      setInvitesError(errorMessage(err, "Code konnte nicht erzeugt werden."));
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleCopy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard-API evtl. nicht verfügbar/verweigert – kein harter Fehler nötig.
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-extrabold text-on-surface">Einstellungen</h1>

      {/* Profil */}
      <section className="rounded-lg border border-surface-container-high bg-surface-container p-6">
        <h2 className="mb-4 text-lg font-bold text-on-surface">Profil</h2>

        {profileLoading && <p className="text-on-surface-muted">Profil wird geladen…</p>}
        {!profileLoading && profileError && !form && <p className="text-error">{profileError}</p>}

        {form && profile && (
          <form className="flex flex-col gap-5" onSubmit={(event) => void handleProfileSubmit(event)}>
            <div className="flex flex-col gap-2">
              <label
                htmlFor="email"
                className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
              >
                E-Mail-Adresse
              </label>
              <input
                id="email"
                type="email"
                readOnly
                disabled
                value={profile.email}
                className="h-12 cursor-not-allowed rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface-muted"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="displayName"
                className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
              >
                Anzeigename
              </label>
              <input
                id="displayName"
                type="text"
                required
                value={form.displayName}
                onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                className="h-12 rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface placeholder:text-on-surface-muted/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="gender"
                  className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                >
                  Geschlecht
                </label>
                <select
                  id="gender"
                  value={form.gender}
                  onChange={(event) =>
                    setForm({ ...form, gender: event.target.value as Gender | "" })
                  }
                  className="h-12 rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Keine Angabe</option>
                  <option value="m">Männlich</option>
                  <option value="w">Weiblich</option>
                  <option value="d">Divers</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="birthDate"
                  className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                >
                  Geburtsdatum
                </label>
                <input
                  id="birthDate"
                  type="date"
                  value={form.birthDate}
                  onChange={(event) => setForm({ ...form, birthDate: event.target.value })}
                  className="h-12 rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="heightCm"
                  className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                >
                  Grösse (cm)
                </label>
                <input
                  id="heightCm"
                  type="number"
                  min={100}
                  max={250}
                  value={form.heightCm}
                  onChange={(event) => setForm({ ...form, heightCm: event.target.value })}
                  className="h-12 rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="goal"
                  className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                >
                  Ziel
                </label>
                <input
                  id="goal"
                  type="text"
                  placeholder="z. B. Kraftaufbau"
                  value={form.goal}
                  onChange={(event) => setForm({ ...form, goal: event.target.value })}
                  className="h-12 rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface placeholder:text-on-surface-muted/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {saveError && (
              <p role="alert" className="text-sm text-error">
                {saveError}
              </p>
            )}
            {saveSuccess && <p className="text-sm text-primary">Gespeichert.</p>}

            <div>
              <button
                type="submit"
                disabled={saving}
                className="h-12 rounded-md bg-primary px-6 font-bold uppercase tracking-wide text-on-primary transition-opacity hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Wird gespeichert…" : "Speichern"}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Einladungscodes */}
      <section className="rounded-lg border border-surface-container-high bg-surface-container p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-on-surface">Einladungscodes</h2>
          <button
            type="button"
            disabled={creatingInvite}
            onClick={() => void handleCreateInvite()}
            className="h-10 rounded-md bg-primary px-4 text-xs font-bold uppercase tracking-widest text-on-primary transition-opacity hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creatingInvite ? "Wird erzeugt…" : "Neuen Code erzeugen"}
          </button>
        </div>

        {newInviteCode && (
          <div className="mt-4 rounded-lg border border-primary/40 bg-surface-container-high p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
              Neuer Code
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <span className="font-mono text-2xl font-extrabold tracking-widest text-primary">
                {newInviteCode}
              </span>
              <button
                type="button"
                onClick={() => void handleCopy(newInviteCode)}
                className="h-10 rounded-md border border-primary px-4 text-xs font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-on-primary"
              >
                {copied ? "Kopiert!" : "Kopieren"}
              </button>
            </div>
          </div>
        )}

        {invitesError && (
          <p role="alert" className="mt-4 text-sm text-error">
            {invitesError}
          </p>
        )}

        <div className="mt-4">
          {invitesLoading && <p className="text-on-surface-muted">Codes werden geladen…</p>}
          {!invitesLoading && invites && invites.length === 0 && (
            <p className="text-on-surface-muted">Noch keine Einladungscodes erzeugt.</p>
          )}
          {!invitesLoading && invites && invites.length > 0 && (
            <ul className="flex flex-col divide-y divide-surface-container-high">
              {invites.map((invite) => (
                <li
                  key={invite.code}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm tracking-widest text-on-surface">
                      {invite.code}
                    </span>
                    <InviteStatusBadge status={invite.status} />
                  </div>
                  <span className="text-xs text-on-surface-muted">
                    {invite.status === "verwendet" && invite.usedAt !== null
                      ? `Verwendet am ${new Date(invite.usedAt).toLocaleDateString("de-CH")}`
                      : `Gültig bis ${new Date(invite.expiresAt).toLocaleDateString("de-CH")}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Tarif & Konto */}
      <section className="rounded-lg border border-surface-container-high bg-surface-container p-6">
        <h2 className="mb-4 text-lg font-bold text-on-surface">Tarif &amp; Konto</h2>

        <div className="flex items-center gap-3">
          <span className="text-sm text-on-surface-muted">Aktueller Tarif</span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${
              entitlements.tier === "free"
                ? "bg-surface-container-high text-on-surface-muted"
                : "bg-primary text-on-primary"
            }`}
          >
            {TIER_LABELS[entitlements.tier]}
          </span>
        </div>

        <div className="mt-6 border-t border-surface-container-high pt-6">
          <button
            type="button"
            onClick={() => void signOut()}
            className="h-12 rounded-md border border-error px-6 text-xs font-bold uppercase tracking-widest text-error transition-colors hover:bg-error hover:text-surface"
          >
            Abmelden
          </button>
        </div>
      </section>
    </div>
  );
}
