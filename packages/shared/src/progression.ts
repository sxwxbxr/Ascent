/**
 * Schätzt das Einwiederholungsmaximum (1RM) nach der Epley-Formel: `gewicht * (1 + wdh / 30)`.
 *
 * Bei genau einer Wiederholung wird exakt das Gewicht zurückgegeben (statt des rechnerisch
 * identischen, aber floating-point-behafteten Formel-Ergebnisses).
 *
 * @param weightKg Bewegtes Gewicht in kg
 * @param reps Anzahl Wiederholungen im besten Satz der Übung
 * @returns Geschätztes 1RM in kg
 */
export function epley1Rm(weightKg: number, reps: number): number {
  if (reps === 1) {
    return weightKg;
  }
  return weightKg * (1 + reps / 30);
}

/**
 * Einfache lineare Regression (Methode der kleinsten Quadrate) über Punkte `{ x, y }`.
 *
 * @param points Datenpunkte, Reihenfolge ist irrelevant
 * @returns `{ slope, intercept }`, oder `null` bei weniger als zwei Punkten oder wenn alle
 * x-Werte identisch sind (die Steigung wäre mathematisch nicht definiert)
 */
export function linearRegression(
  points: ReadonlyArray<{ x: number; y: number }>,
): { slope: number; intercept: number } | null {
  const n = points.length;
  if (n < 2) {
    return null;
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (const { x, y } of points) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) {
    return null;
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

/**
 * Kraft-Trend einer Übung: lineare Regression über die geschätzten 1RM-Werte je
 * Trainingseinheit (x = Datum in Epoch ms, y = bestes 1RM der Einheit).
 *
 * Gemäss Lastenheft wird eine Trendlinie erst ab 3-5 erfassten Einheiten angezeigt;
 * `minSessions` steuert diese Schwelle (Default: die untere Grenze, 3).
 *
 * @param sessions Trainingseinheiten mit Datum und bestem 1RM; Reihenfolge irrelevant
 * @param minSessions Mindestanzahl Einheiten, ab der ein Trend berechnet wird
 * @returns `null` unterhalb der Mindestanzahl (oder bei nicht-berechenbarer Regression),
 * sonst Steigung/Achsenabschnitt sowie eine `predict`-Funktion für ein beliebiges Datum
 */
export function strengthTrend(
  sessions: ReadonlyArray<{ date: number; best1Rm: number }>,
  minSessions = 3,
): { slope: number; intercept: number; predict: (dateMs: number) => number } | null {
  if (sessions.length < minSessions) {
    return null;
  }

  const regression = linearRegression(
    sessions.map((session) => ({ x: session.date, y: session.best1Rm })),
  );

  if (regression === null) {
    return null;
  }

  const { slope, intercept } = regression;

  return {
    slope,
    intercept,
    predict: (dateMs: number) => slope * dateMs + intercept,
  };
}
