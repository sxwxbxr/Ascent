/**
 * M1-Stub für den Mail-Versand: loggt strukturiert statt tatsächlich zu senden.
 * Aufrufer (z. B. Better-Auth-Passwort-Reset in src/auth/auth.ts) kennen nur
 * dieses Interface — der Wechsel auf einen echten Anbieter (Resend o. Ä.)
 * bleibt so ein reiner Implementierungsdetail-Tausch in dieser Datei.
 */
export type SendMailOptions = {
  to: string;
  subject: string;
  text: string;
};

/**
 * "Versendet" eine Mail, indem sie strukturiert geloggt wird (M1-Stub).
 * TODO(M-später): Resend/SES o. Ä. einstecken; Signatur/Interface stabil halten.
 */
export async function sendMail({ to, subject, text }: SendMailOptions): Promise<void> {
  console.log('[mail:stub]', JSON.stringify({ to, subject, text }));
}
