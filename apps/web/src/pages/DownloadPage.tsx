interface SideloadStep {
  number: number;
  title: string;
  description: string;
}

const steps: SideloadStep[] = [
  {
    number: 1,
    title: "Unbekannte Quellen erlauben",
    description:
      "Aktiviere in den Android-Einstellungen unter Sicherheit die Installation aus unbekannten Quellen für deinen Browser.",
  },
  {
    number: 2,
    title: "APK herunterladen",
    description:
      "Lade die signierte Ascent-APK über den Button oben auf dein Gerät herunter.",
  },
  {
    number: 3,
    title: "Installation bestätigen",
    description:
      "Öffne die heruntergeladene Datei und bestätige die Installation. Nach kurzer Zeit ist Ascent startbereit.",
  },
  {
    number: 4,
    title: "Anmelden",
    description:
      "Starte die App und melde dich mit deinem bestehenden Ascent-Konto an.",
  },
];

export function DownloadPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold text-on-surface">
          Android-App herunterladen
        </h1>
        <p className="mt-2 text-on-surface-muted">
          Ascent ist vorerst nicht im Play Store erhältlich – installiere die
          App direkt per Sideloading.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-lg border border-surface-container-high bg-surface-container p-8 text-center">
        <button
          type="button"
          disabled
          className="h-12 cursor-not-allowed rounded-md bg-surface-container-high px-6 font-bold uppercase tracking-wide text-on-surface-muted"
        >
          APK herunterladen (bald verfügbar)
        </button>
        <p className="text-xs text-on-surface-muted">
          Erfordert Android 8.0 oder neuer.
        </p>
      </div>

      <div className="rounded-lg border border-primary/40 bg-surface-container p-6">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold uppercase tracking-widest text-on-primary">
            Beta
          </span>
          <h2 className="font-bold text-on-surface">
            Aktuelle Beta-APK über GitHub Actions
          </h2>
        </div>
        <p className="mt-3 text-sm text-on-surface-muted">
          Bis der Download-Button hier in M6 live geht, findest du den
          neuesten Build als Actions-Artefakt:{" "}
          <span className="text-on-surface">
            GitHub → Actions → neuester &bdquo;Android APK&ldquo;-Lauf →
            Artefakt &bdquo;ascent-beta-apk&ldquo;
          </span>
          .
        </p>
        <a
          href="https://github.com/sxwxbxr/Ascent/actions/workflows/android-apk.yml"
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex h-10 items-center rounded-md border border-primary px-4 text-xs font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-on-primary"
        >
          Zu den GitHub Actions
        </a>
        <p className="mt-4 text-xs text-on-surface-muted">
          Hinweis: Die APK ist bis zum eigenen Signing-Keystore (M6)
          Debug-signiert. Beim späteren Umstieg auf die final signierte
          Version ist einmalig eine Deinstallation der Beta nötig.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {steps.map((step) => (
          <div
            key={step.number}
            className="flex gap-4 rounded-lg border border-surface-container-high bg-surface-container p-6"
          >
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary">
              {step.number}
            </span>
            <div>
              <h2 className="font-bold text-on-surface">{step.title}</h2>
              <p className="mt-1 text-sm text-on-surface-muted">
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
