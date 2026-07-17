/**
 * Schlanker fetch-Wrapper für alle Datenrouten (/plans, /workouts, /exercises,
 * /body-metrics, /profile, /invites, /sync, /entitlements, …). Alle Aufrufe
 * sind same-origin (siehe vite.config.ts) und Session-Cookie-basiert, daher
 * immer `credentials: 'include'`. Fehlerantworten der API haben die Form
 * `{ error: string, details?: unknown }` (siehe apps/api/src/routes/helpers.ts)
 * – wird hier in {@link ApiError} übersetzt, damit Aufrufer nicht jedes Mal
 * die Response selbst parsen müssen.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

type ErrorBody = { error?: unknown; details?: unknown };

function isErrorBody(value: unknown): value is ErrorBody {
  return typeof value === "object" && value !== null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  // 204 No Content (z. B. DELETE) – kein Body zu parsen.
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let data: unknown = undefined;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!response.ok) {
    const message =
      isErrorBody(data) && typeof data.error === "string"
        ? data.error
        : `Anfrage fehlgeschlagen (${response.status})`;
    throw new ApiError(response.status, message, isErrorBody(data) ? data.details : undefined);
  }

  return data as T;
}

/** JSON-Helper für die CRUD-/Sync-Routen. Pfade sind same-origin, z. B. `api.get('/plans')`. */
export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T = void>(path: string): Promise<T> => request<T>(path, { method: "DELETE" }),
};
