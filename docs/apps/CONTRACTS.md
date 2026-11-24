# Native apps: contracts between the shells and the server

These are the wire contracts that the desktop shell, the service worker and the server share. §2 and §3 of [the plan](https://github.com/orweis/phean-apps/blob/main/docs/PLAN.md) say why. Change them only additively, because installed shells are older than the server (see `minShellVersion` below).

Every request a shell or the service worker makes carries `Phean-Client: desktop` or `Phean-Client: web`. Because it is a custom header, a cross-origin page cannot send it without a CORS preflight, and Phean answers no preflight. Bodies are JSON (`Content-Type: application/json`). When a browser sends an `Origin`, it must equal the app origin. `Sec-Fetch-Site`, when sent, must be `same-origin` or `none`. Electron's `session.fetch` from the desktop's main process sends `none` and no `Origin`; a cross-site page can never send `none`. The handoff's start and exchange are stricter (below): no `Origin` at all, and the desktop sends them with `credentials: "omit"`.

## Desktop sign-in handoff (loopback, RFC 8252 §7.3)

1. **`POST /api/auth/native/start`**. The body is `{ "client": "desktop", "codeChallenge": "<base64url(sha256(verifier))>", "redirectUri": "http://127.0.0.1:<port>/callback", "state": "<random>" }`.
   - The request needs `Phean-Client: desktop`, and is refused if it carries `Origin`, or a `Sec-Fetch-Site` other than `none` (what Electron's `session.fetch` sends; no page can).
   - The redirect URI must be `http://127.0.0.1:<port>/callback` with a port from 1024 to 65535.
   - It answers `200 { "requestId": "<id>", "confirmation": "K7QM", "expiresAt": "<ISO>" }`. The request lives for 10 minutes, long enough to sign in from scratch in the browser, and is rate limited per address.
2. **The browser opens `GET /native/authorize?request=<requestId>`** (`routes.nativeAuthorize(requestId)`).
   - Without a full session it sends the person to sign in, with `next` set back to this page.
   - A pending two-factor challenge is not a session.
   - The page shows the account, the confirmation code and one button: "Sign in to Phean desktop". It also has a way to decline.
3. **Confirming** stores a one-time code: 32 random bytes, hashed, single use, bound to the request, the user and the challenge, with a 2-minute life. The browser is then sent **303** to `<redirectUri>?code=<code>&state=<state>`. Declining sends it 303 to `<redirectUri>?error=access_denied&state=<state>`.
4. **`POST /api/auth/native/exchange`**. The body is `{ "requestId": "<id>", "code": "<code>", "codeVerifier": "<verifier>" }`.
   - The request needs `Phean-Client: desktop`. It is refused if it carries `Origin`, a `Sec-Fetch-Site` other than `none`, or a Phean session cookie.
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
      "options": ["Okafor", "Lindqvist"], "multiple": false, "askedAt": "2026-11-21T09:00:00.000Z",
      "notify": true
    }
  ]
}
```

Items are the open requests, newest first, at most 50. The desktop notifies for request ids it has not seen, and closes notifications whose ids are gone.

- `notify` (added after shell 0.1.0) is `false` when the person turned off "New requests from agents" on the Account page. The desktop then lists the item and counts it, but shows no notification for it. A shell that does not know the field notifies as before; one that does treats a missing `notify` as `true`.

## Answering from a notification

**`POST /w/<slug>/push/answer`** (`routes.pushAnswer(slug)`). The body is `{ "taskId": "t_...", "requestId": "q_...", "option": 0 }`, or, for a text reply, `{ "taskId", "requestId", "answer": "free text" }`.

- `option` is an index into the open request's options. The server reads the label from the request and never takes it from the client.
- `endpoint` (optional) is the answering device's own push subscription endpoint, as the service worker reads it from `registration.pushManager.getSubscription()`. Every other device of everyone told about the request, the person's own included, has its notification replaced by a `resolved` push; the device named here does not, since it shows the answer it sent. Without it (the desktop, a web answer) every device is told. An endpoint that is not one of the person's own devices is ignored.
- `200 { "answer": "Okafor", "taskTitle": "Pick the auditor", "agentName": "Scout" }` on success.
- `409 { "error": "stale", "message": "…" }` when the request was already answered or replaced.
- `401` for no session, and `404` for a workspace the person is not in.

**`POST /w/<slug>/push/undo`**. The body is `{ "taskId", "requestId" }`, with the same optional `endpoint`. It runs `retractAnswer` and answers `200 {}`, `403` when someone else gave the answer (only the person who answered takes it back), or `409` once the agent has collected the answer. The request is open again on every device but the one named by `endpoint`, which shows it again itself.

## Web Push payload (service worker)

The payload is JSON, at most 3 KB. The notification `tag` is always the `requestId`.

```json
{ "v": 1, "type": "request", "slug": "acme", "workspaceName": "Acme", "requestId": "q_...", "taskId": "t_...",
  "agentName": "Scout", "kind": "decision", "question": "Which auditor?", "options": ["Okafor", "Lindqvist"],
  "answerable": true }
```

- `options` holds at most the first two options, each in full: an option is never cut. It is empty, with `answerable: false`, when the request takes several answers, when the device has not turned on "Answer from notifications", or when either of the first two options is longer than 80 characters (the person opens the request instead).
- The service worker titles a request "Scout asks · Acme", so what follows reads as the agent's words.
- A device marked private gets `{ "v": 1, "type": "request", "private": true, "slug", "workspaceName", "requestId", "taskId" }`, shown as "A decision is waiting in Acme".
- A person is never pushed what they did themselves: no `resolved` for a request they answered or closed, and no `request` for an answer they took back (the device they took it back from shows the request again itself). Each person also chooses on the Account page whether they get new requests (`request`), answers someone else took back (`request` again), and requests answered or closed elsewhere (`resolved`). The server applies both when it queues a push and again when it sends one; the payload does not change.
- When the request is closed elsewhere, the device gets `{ "v": 1, "type": "resolved", "slug", "requestId", "reason": "answered", "by": "Dana" }`. It replaces the notification with the same tag, for example "Answered by Dana".
  - `reason` is `answered` (a person answered it), `replaced` (its agent asked a new question on the same task, which arrives as its own `request` push) or `closed` (its agent closed it, or the task was completed, released or moved on). A worker that does not know a reason treats it as a payload without one.
  - `by` is optional, and only ever the person who answered: it is sent only with `answered`. With `closed`, the optional `closedBy` names who closed it ("Closed by Scout"); `replaced` names no one ("Replaced by a new question"). A worker that reads only `by` therefore never says an agent answered.
  - A private device gets no `by` or `closedBy`.

- The notification's `icon` is the colourful app icon (`/icons/192.png`). Its `badge`, the small status-bar icon, is a white silhouette on transparency, since Android keeps only a badge's alpha: `/icons/badge-request.png` for a request, `/icons/badge-resolved.png` once it is settled (resolved, or sent from this device).
- A click opens `routes.request(slug, requestId)`, built from the ids and never from a URL in the payload. An action button posts `/w/<slug>/push/answer` with `option` set to the button's index. On success it shows "Sent “Okafor” to Scout" with an Undo action, which posts `/w/<slug>/push/undo`.
- The service worker is `/sw.js` with scope `/`. Its pure logic lives in `src/lib/push.ts`.

## Android

- The package is `app.phean`. The launcher opens `https://<domain>/workspaces`.
- App Links cover `https://<domain>/w/*`.
- `/.well-known/assetlinks.json` is built from `PHEAN_ANDROID_PACKAGE` (default `app.phean`) and `PHEAN_ANDROID_CERT_SHA256`, a comma-separated list of SHA-256 fingerprints in `AA:BB:…` form. With no fingerprints it is an empty list `[]`.
