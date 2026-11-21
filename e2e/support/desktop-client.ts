import { createHash, randomBytes } from "node:crypto";

import { loopbackReceiver } from "./oauth-client";

export const DESKTOP_STATE = "e2e-desktop-state";

export interface DesktopSignIn {
  requestId: string;
  /** The code the app shows, which the browser page must show too. */
  confirmation: string;
  /** Where the app sends the person's browser. */
  authorizePath: string;
  /** What the browser brought back to the loopback receiver. */
  callback: Promise<URL>;
  /** Trades the code for a session, as the app's main process does. */
  exchange: (code: string) => Promise<Response>;
  close: () => void;
}

/**
 * The desktop app's main process, scripted: a loopback receiver, a PKCE verifier, and the request
 * registered with `POST /api/auth/native/start`, from outside any browser.
 */
export async function desktopSignIn(baseUrl: string): Promise<DesktopSignIn> {
  const receiver = await loopbackReceiver();
  const verifier = randomBytes(32).toString("base64url");
  const headers = { "content-type": "application/json", "phean-client": "desktop" };
  const started = await fetch(`${baseUrl}/api/auth/native/start`, {
    method: "POST",
    headers,
    body: JSON.stringify({ client: "desktop", codeChallenge: createHash("sha256").update(verifier).digest("base64url"), redirectUri: receiver.redirectUri, state: DESKTOP_STATE }),
  });
  if (!started.ok) throw new Error(`native start failed: ${started.status} ${await started.text()}`);
  const { requestId, confirmation } = (await started.json()) as { requestId: string; confirmation: string };
  return {
    requestId,
    confirmation,
    authorizePath: `/native/authorize?request=${encodeURIComponent(requestId)}`,
    callback: receiver.received,
    exchange: (code) => fetch(`${baseUrl}/api/auth/native/exchange`, { method: "POST", headers, body: JSON.stringify({ requestId, code, codeVerifier: verifier }) }),
    close: receiver.close,
  };
}
