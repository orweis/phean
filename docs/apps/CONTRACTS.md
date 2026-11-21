# Native apps: contracts between the shells and the server

These are the wire contracts that the desktop shell, the service worker and the server share. [the plan](https://github.com/orweis/phean-apps/blob/main/docs/PLAN.md) §2 and §3 say why. Change them only additively, because installed shells are older than the server (see `minShellVersion` below).

Every request a shell or the service worker makes carries `Phean-Client: desktop` or `Phean-Client: web`. Because it is a custom header, a cross-origin page cannot send it without a CORS preflight, and Phean answers no preflight. Bodies are JSON (`Content-Type: application/json`). When a browser sends an `Origin`, it must equal the app origin.

## Desktop sign-in handoff (loopback, RFC 8252 §7.3)

1. **`POST /api/auth/native/start`**. The body is `{ "client": "desktop", "codeChallenge": "<base64url(sha256(verifier))>", "redirectUri": "http://127.0.0.1:<port>/callback", "state": "<random>" }`.
   - The request needs `Phean-Client: desktop`, and is refused if it carries `Origin` or `Sec-Fetch-Site`.
   - The redirect URI must be `http://127.0.0.1:<port>/callback` with a port from 1024 to 65535.
   - It answers `200 { "requestId": "<id>", "confirmation": "K7QM", "expiresAt": "<ISO>" }`. The request lives for 2 minutes and is rate limited per address.
2. **The browser opens `GET /native/authorize?request=<requestId>`** (`routes.nativeAuthorize(requestId)`).
   - Without a full session it sends the person to sign in, with `next` set back to this page.
   - A pending two-factor challenge is not a session.
   - The page shows the account, the confirmation code and one button: "Sign in to Phean desktop". It also has a way to decline.
3. **Confirming** stores a one-time code: 32 random bytes, hashed, single use, bound to the request, the user and the challenge, with a 2-minute life. The browser is then sent **303** to `<redirectUri>?code=<code>&state=<state>`. Declining sends it 303 to `<redirectUri>?error=access_denied&state=<state>`.
4. **`POST /api/auth/native/exchange`**. The body is `{ "requestId": "<id>", "code": "<code>", "codeVerifier": "<verifier>" }`.
   - The request needs `Phean-Client: desktop`. It is refused if it carries `Origin` or `Sec-Fetch-Site`, or a Phean session cookie.
   - It answers `200 { "user": { "id", "name", "email" } }` with the Better Auth session cookies in `Set-Cookie`. The session's user agent is `Phean desktop`.
   - The desktop reads `response.headers.getSetCookie()` and applies each cookie to the `persist:phean` partition with `session.cookies.set`.
   - Errors are `400 { "error": "invalid_request" | "invalid_grant" }`.

## Desktop preload API (`window.pheanDesktop`)

```ts
interface PheanDesktop {
  version: string;                                   // the shell's version, e.g. "0.1.0"
  platform: "darwin" | "win32" | "linux";
  signInWithBrowser(provider: "github" | "google"): Promise<void>;  // resolves once signed in; the window then reloads
  openInBrowser(path: string): Promise<void>;        // a same-origin path (account linking, password reset) opened in the system browser
}
```

The web app checks `typeof window.pheanDesktop !== "undefined"`. Inside the desktop app, the GitHub and Google buttons call `signInWithBrowser`, and provider linking on `/account` calls `openInBrowser(routes.account())`.

## Inbox feed (desktop)

**`GET /api/native/inbox`** (`routes.nativeInbox()`). It takes the session cookie, `Phean-Client: desktop` and an optional `If-None-Match`.

- `200` returns the body below, with an `ETag` and `Cache-Control: no-store`. `304` means nothing changed. `401` means no live session.
- It covers every workspace the person is a **member** of; platform admins' read-only workspaces are not included. A muted workspace is left out of `items`, but still counts in `pending`.

```json
{
  "pending": 3,
  "minShellVersion": "0.1.0",
  "items": [
    {
      "requestId": "q_...", "taskId": "t_...", "slug": "acme", "workspaceName": "Acme",
      "agentName": "Scout", "kind": "decision", "question": "Which auditor?",
      "options": ["Okafor", "Lindqvist"], "multiple": false, "askedAt": "2026-11-21T09:00:00.000Z"
    }
  ]
}
```

Items are the open requests, newest first, at most 50. The desktop notifies for request ids it has not seen, and closes notifications whose ids are gone.

## Answering from a notification

**`POST /w/<slug>/push/answer`** (`routes.pushAnswer(slug)`). The body is `{ "taskId": "t_...", "requestId": "q_...", "option": 0 }`, or, for a text reply, `{ "taskId", "requestId", "answer": "free text" }`.

- `option` is an index into the open request's options. The server reads the label from the request and never takes it from the client.
- `200 { "answer": "Okafor", "taskTitle": "Pick the auditor", "agentName": "Scout" }` on success.
- `409 { "error": "stale", "message": "…" }` when the request was already answered or replaced.
- `401` for no session, and `404` for a workspace the person is not in.

**`POST /w/<slug>/push/undo`**. The body is `{ "taskId", "requestId" }`. It runs `retractAnswer` and answers `200 {}`, or `409` once the agent has collected the answer.

## Web Push payload (service worker)

The payload is JSON, at most 3 KB. The notification `tag` is always the `requestId`.

```json
{ "v": 1, "type": "request", "slug": "acme", "workspaceName": "Acme", "requestId": "q_...", "taskId": "t_...",
  "agentName": "Scout", "kind": "decision", "question": "Which auditor?", "options": ["Okafor", "Lindqvist"],
  "answerable": true }
```

- `options` holds at most the first two options. It is empty when the request takes several answers, or when the device has not turned on "Answer from notifications" (`answerable: false`).
- A device marked private gets `{ "v": 1, "type": "request", "private": true, "slug", "workspaceName", "requestId", "taskId" }`, shown as "A decision is waiting in Acme".
- When the request is closed elsewhere, the device gets `{ "v": 1, "type": "resolved", "slug", "requestId", "by": "Dana" }`. It replaces the notification with the same tag, for example "Answered by Dana".
- A click opens `routes.request(slug, requestId)`, built from the ids and never from a URL in the payload. An action button posts `/w/<slug>/push/answer` with `option` set to the button's index. On success it shows "Sent “Okafor” to Scout" with an Undo action, which posts `/w/<slug>/push/undo`.
- The service worker is `/sw.js` with scope `/`. Its pure logic lives in `src/lib/push.ts`.

## Android

- The package is `app.phean`. The launcher opens `https://<domain>/workspaces`.
- App Links cover `https://<domain>/w/*`.
- `/.well-known/assetlinks.json` is built from `PHEAN_ANDROID_PACKAGE` (default `app.phean`) and `PHEAN_ANDROID_CERT_SHA256`, a comma-separated list of SHA-256 fingerprints in `AA:BB:…` form. With no fingerprints it is an empty list `[]`.
