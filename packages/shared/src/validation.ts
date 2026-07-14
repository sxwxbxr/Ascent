import { z } from 'zod';

/** Registrierung: E-Mail, Passwort (mind. 8 Zeichen) und Anzeigename. */
export const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;

/** Login: E-Mail und Passwort. */
export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Profil-Update: nur der Anzeigename ist Pflicht, der Rest ist optional. */
export const profileSchema = z.object({
  displayName: z.string().min(1),
  gender: z.enum(['m', 'w', 'd']).optional(),
  /** ISO-Datum (YYYY-MM-DD) */
  birthDate: z.iso.date().optional(),
  heightCm: z.number().int().min(100).max(250).optional(),
  goal: z.string().optional(),
});

export type ProfileInput = z.infer<typeof profileSchema>;

/** Satz-Logging während eines Workouts: Gewicht (kg) und Wiederholungen. */
export const workoutSetSchema = z.object({
  weightKg: z.number().positive().max(1000),
  reps: z.number().int().min(1).max(100),
});

export type WorkoutSetInput = z.infer<typeof workoutSetSchema>;
