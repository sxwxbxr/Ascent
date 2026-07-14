import { describe, expect, it } from 'vitest';
import { epley1Rm, linearRegression, strengthTrend } from './progression';

describe('epley1Rm', () => {
  it('liefert bei genau einer Wiederholung exakt das Gewicht zurück', () => {
    expect(epley1Rm(100, 1)).toBe(100);
  });

  it('schätzt das 1RM nach der Epley-Formel', () => {
    expect(epley1Rm(100, 10)).toBeCloseTo(133.33, 2);
  });
});

describe('linearRegression', () => {
  it('liefert bei exakt linearen Punkten die exakte Steigung und den exakten Achsenabschnitt', () => {
    const points = [
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
      { x: 3, y: 7 },
    ];

    const result = linearRegression(points);

    expect(result).not.toBeNull();
    expect(result?.slope).toBeCloseTo(2);
    expect(result?.intercept).toBeCloseTo(1);
  });

  it('liefert null bei weniger als zwei Punkten', () => {
    expect(linearRegression([{ x: 1, y: 1 }])).toBeNull();
  });

  it('liefert null, wenn alle x-Werte identisch sind', () => {
    const points = [
      { x: 5, y: 1 },
      { x: 5, y: 2 },
      { x: 5, y: 3 },
    ];

    expect(linearRegression(points)).toBeNull();
  });
});

describe('strengthTrend', () => {
  it('liefert null bei weniger als 3 (Default) Trainingseinheiten', () => {
    const sessions = [
      { date: 1, best1Rm: 100 },
      { date: 2, best1Rm: 110 },
    ];

    expect(strengthTrend(sessions)).toBeNull();
  });

  it('liefert bei 4 linear steigenden Einheiten eine positive Steigung und plausible Prognosen', () => {
    const sessions = [
      { date: 1, best1Rm: 100 },
      { date: 2, best1Rm: 110 },
      { date: 3, best1Rm: 120 },
      { date: 4, best1Rm: 130 },
    ];

    const trend = strengthTrend(sessions);

    expect(trend).not.toBeNull();
    expect(trend?.slope).toBeGreaterThan(0);
    expect(trend?.predict(5)).toBeCloseTo(140, 5);
    expect(trend?.predict(1)).toBeCloseTo(100, 5);
  });
});
