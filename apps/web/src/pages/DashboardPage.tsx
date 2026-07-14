import { useEffect, useState } from "react";

type ApiStatus = "checking" | "online" | "offline";

interface PlaceholderCard {
  title: string;
}

const placeholderCards: PlaceholderCard[] = [
  { title: "Kraftverlauf" },
  { title: "Körpergewicht" },
  { title: "Letzte Trainings" },
];

export function DashboardPage() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    let cancelled = false;

    async function checkApiHealth() {
      try {
        const response = await fetch("/api/health");
        if (!cancelled) {
          setApiStatus(response.ok ? "online" : "offline");
        }
      } catch {
        if (!cancelled) {
          setApiStatus("offline");
        }
      }
    }

    void checkApiHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-extrabold text-on-surface">Dashboard</h1>

      <div className="rounded-lg border border-surface-container-high bg-surface-container p-4">
        <div className="flex items-center gap-3">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              apiStatus === "online"
                ? "bg-primary"
                : apiStatus === "offline"
                  ? "bg-error"
                  : "bg-on-surface-muted"
            }`}
            aria-hidden="true"
          />
          <span className="text-sm text-on-surface-muted">
            {apiStatus === "checking" && "API wird geprüft…"}
            {apiStatus === "online" && "API erreichbar"}
            {apiStatus === "offline" && "API offline"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {placeholderCards.map((card) => (
          <div
            key={card.title}
            className="rounded-lg border border-surface-container-high bg-surface-container p-6"
          >
            <h2 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
              {card.title}
            </h2>
            <p className="mt-4 text-sm text-on-surface-muted">
              Daten folgen mit M5.
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
