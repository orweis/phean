import { emailConfig } from "../config";

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Sends one email; the digest sender takes it as a parameter so tests can catch the mail instead. */
export type SendEmail = (email: Email) => Promise<void>;

const RESEND_URL = "https://api.resend.com/emails";

/** Sends through Resend with this deployment's key and From address, or refuses when email is not set up. */
export const sendEmail: SendEmail = async (email) => {
  const config = emailConfig();
  if (!config) throw new Error("Email is not set up: set RESEND_API_KEY and PHEAN_EMAIL_FROM.");
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: config.from, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Resend refused the email: ${response.status} ${(await response.text()).slice(0, 200)}`);
};
