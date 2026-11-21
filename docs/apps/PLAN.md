# Phean native apps: plan

Status: **M0, reviewed.** Three independent reviews (security, platform architecture, fit with AGENTS.md) are folded in; §8 records what changed and what was rejected. The owner reviews and merges every native-app PR.

Phean people mostly do one thing: answer the Decisions agents are waiting on. The native apps exist to make that faster than a browser tab: a notification the moment an agent asks, an answer in one or two taps, and Phean one keystroke away on the desktop. Everything else (tasks, goals, documents) is the hosted web app, which already has responsive layouts down to 375px.

The owner uses the **desktop app** and the **Android app**. Those come first and must be excellent. **iOS** comes later and should cost little.

## Governing principle: web-first, native at the edges

The owner's rule: *rely as much as we can on web interfaces, so that new surfaces in the web app easily carry over into the apps.*

- **Every screen people use comes from the hosted web app.** That covers tasks, goals, Decisions, documents, settings and account. There are no native re-implementations. A page added to the web app appears in the desktop and Android apps with no app-side work and no app release.
  - The desktop allows navigation by **origin**, never by path, and has a test proving it.
  - The TWA is Chrome on the origin, so it gets this by construction.
- **Native code covers only what the web cannot do well:**
  - the system-browser sign-in handoff;
  - push registration and notification actions;
  - deep links and App Links;
  - the tray, badge and global shortcut;
  - auto-update;
  - secure storage;
  - offline and reconnect chrome.

  Each is reached through **one small typed bridge** (`window.pheanDesktop`, [CONTRACTS.md](CONTRACTS.md)). The web app feature-detects it, with a web fallback, so the same page works in a plain browser, on the desktop and on Android. On Android the bridge is the web platform itself: Web Push, the manifest and the service worker.
- **The web app must be good on small screens and inside a shell.**
  - The 375px checks in `e2e/quality.spec.ts` are the mobile gate.
  - Touch targets and safe-area insets (`env(safe-area-inset-*)` with `viewport-fit=cover`) are audited along with M2.
  - A page knows it runs in a shell only by the bridge's presence (`window.pheanDesktop`) or `display-mode: standalone`. It uses that to adjust chrome, such as hiding "open in app" or offering "Continue in your browser". Layouts are never forked per platform.
- **This principle helped choose the stack.** The winning options load the hosted origin directly and need the least per-platform code: the TWA needs none beyond its manifest, and the Electron shell needs only the edge features above. Options that need a bundled client, or a bridge every page must code against, lose on this criterion as well as on cost (§1, §8).
- **It binds contributors.** `AGENTS.md` carries it as a rule: build new surfaces in the web app; add a native capability only through the shared bridge, with a web fallback; treat the 375px checks as the mobile gate.

## 1. Approach

### What was checked (2026-11-21, npm registry, re-verified by a reviewer)

| Option | Current version | Maintenance |
| --- | --- | --- |
| Electron | 45.4.1 (45.0.0 shipped 2026-10-21; 44.0.0 2026-08-25; 43.0.0 2026-06-30) | A major every 8 weeks. The latest three majors get security fixes, so an app must move a major at least every ~6 months (enforced in CI, §5) |
| electron-builder / electron-updater | 26.18.0 / 6.8.11 (both published 2026-11-21) | Active, weekly releases |
| Electron Forge | 8.0.1 (2026-09-29) | Active and official, but its updater is Squirrel, which has no Linux |
| @electron/fuses | 2.1.3 | Active |
| Capacitor (core, android, push-notifications, app) | 8.6.2, 8.6.2, 8.1.3, 8.1.2 (8.0.0 shipped 2025-12-08) | Active, monthly minors |
| Tauri 2 (cli, api) | 2.12.6, 2.12.5 (2.0.0 2024-10-02, 2.12.0 2026-09-26) | Active, a minor every 2-5 months |
| Bubblewrap CLI (TWA project generator) | 1.27.0 (2026-10-09) | Active, GoogleChromeLabs; the project it generates depends on the `android-browser-helper` library |
| web-push (VAPID, RFC 8291 encryption) | 4.0.0 (2026-11-06; 3.6.7 was the last 3.x, Jan 2024) | Active again; pin exactly |
| Playwright | 1.65.1 (the root uses ^1.64.1) | First-class Electron support (`_electron.launch`) |

Versions are re-read with `npm view <pkg> version` when code lands. This table is the evidence for the decision, not a pin.

### The constraint that decides it

Phean's web app is server-rendered: App Router, server components, server actions, cookie sessions. There is no static client to bundle, so every option is a **shell around the hosted origin**. A bundled client would mean a second front end and an API for it. That is by far the most expensive option, so it is rejected.

Inside a shell, the hard problems are the same three on every platform:

- **Provider sign-in.** Google refuses OAuth in embedded webviews, and GitHub increasingly does too.
- **Push notifications.** They need a push service and server work.
- **The privileged bridge.** Its security matters, because it is exposed to web content that shows agent-written text.

### Options weighed

**A. Electron (desktop) + Capacitor (Android, iOS), both loading the hosted origin.**
- **Electron** has the strongest desktop story:
  - a tray, a badge and a global shortcut;
  - native notifications with actions and inline reply (`hasReply` on macOS and Windows), plus `Notification.handleActivation` for clicks on a toast while the app is closed;
  - a mature updater: electron-updater handles NSIS on Windows and DMG/ZIP on macOS;
  - one Chromium everywhere, so the tokens, `backdrop-filter` and fonts render as in Chrome;
  - Playwright drives it in CI.

  The costs are ~100 MB installers, a major upgrade every 8 weeks, and a large attack surface that must be locked down (§4).
- **Capacitor on Android** runs in the Android System WebView, which brings three problems:
  - Provider sign-in must leave the webview and come back by App Link, with a code exchange into the webview's cookie jar.
  - Native FCM push needs a Firebase project and server-side FCM credentials.
  - Loading a remote origin (`server.url`) is, by Capacitor's own docs, meant for live reload, not production. With it, the bridge and every installed plugin are callable by the remote page.

**B. Tauri 2 everywhere.** One Rust core, the system webview on each platform, and capability files that scope what the page may call. It has smaller binaries and a tighter default posture. But:
- On Android it is the same System WebView as Capacitor: the same sign-in workaround, and no first-party push plugin (community FCM plugins only).
- On the desktop the webview differs per OS (WebView2, WKWebView, WebKitGTK). WebKitGTK supports the CSS Phean uses, but it varies by distro version and has known performance problems with `backdrop-filter`. Playwright cannot drive it, and Tauri's WebDriver support covers Linux and Windows only.
- It adds a Rust toolchain and a second language for a team that writes only TypeScript.
- Its selling point, one codebase, shrinks once Android is not a webview app (below).

**C. An installable PWA as the base layer, with a Trusted Web Activity (TWA) on Android.**
- A TWA is a thin Android app that opens the verified origin in **Chrome itself**, full screen, with no URL bar once Digital Asset Links verify. Because it is Chrome, not a webview:
  - Google and GitHub sign-in, password managers, passkeys and the two-factor challenge work exactly as on the web, with no auth code at all.
  - There is no JavaScript bridge to secure.
  - App Links come from the same Digital Asset Links file.
- Notifications are **Web Push** from the PWA's service worker. Chrome delegates them to the TWA's exported `DelegationService`, so they show under Phean's name and icon with up to two action buttons, and the launcher badges them.
- Web Push needs only a VAPID key pair on the server. There is no Firebase project and no FCM server key. The same code serves desktop browsers.
- Its limits:
  - no inline *text* reply in a Web Push notification, only buttons;
  - Chrome, or another TWA-capable browser, must be on the device;
  - Web Push cannot set Android's private lock-screen visibility (handled in §2);
  - anything native beyond the web platform needs a native app later.

### Recommendation

**A PWA base layer, Electron for desktop and a TWA for Android. iOS comes later as a home-screen PWA with plain notifications, and as a native shell only if App Store presence is wanted.**

| Layer | What it is | Why |
| --- | --- | --- |
| Web app (shared) | A web app manifest, a minimal service worker (offline page and Web Push; it never caches signed-in pages), the push device service, an answer-from-notification endpoint, and a person-scoped inbox feed | Written once in the existing Next.js app under the existing rules. Every platform and every browser benefits |
| Desktop | An Electron 45 shell around the hosted origin, packaged with electron-builder and updated by electron-updater | The owner's suggestion holds up. It is the only option with a tray, a badge, a global shortcut, signed auto-update and Playwright e2e on all three OSes with one renderer |
| Android | A TWA project generated by Bubblewrap on `android-browser-helper`, checked in as a small Gradle project | Sign-in, 2FA and App Links come for free, there is no bridge to secure, and Web Push needs no FCM credentials. It is the least code with the smallest attack surface |
| iOS (later) | A home-screen PWA with Web Push (Safari 16.4+), with plain notifications and no action buttons | Costs nothing. A native shell is a separate decision (below) |

**iOS is honestly cheap only as a PWA.** A WKWebView shell (Capacitor) gets no Web Push, so it needs APNs and a native sender. Loading a remote URL is the use Capacitor's docs warn against. App Store guideline 4.2 (minimum functionality) is a real risk for a wrapper around a website. If App Store presence is wanted, plan it then:

- a small native or Capacitor app;
- `ASWebAuthenticationSession` for sign-in, against the same handoff endpoints as the desktop (§3);
- APNs behind the same push service seam (§2).

**Rejected:**
- **Tauri:** its shared-codebase benefit disappears once Android is a TWA, and WebKitGTK plus no Playwright weakens the desktop, the one platform it would own.
- **Capacitor for Android now:** the sign-in workaround, FCM credentials and a bridge exposed to a remote origin, all for the one feature the TWA lacks, inline text replies.
- **A bundled client:** a second front end.

**Revisit when:** the owner wants inline text replies on Android. That means a small native Android app reusing §3's handoff and adding an FCM sender behind the push service. Revisit also if Chrome changes TWA support.

### What each platform still needs on its own

- **Desktop:**
  - the tray and badge, and the global shortcut;
  - the loopback sign-in handoff and the `phean://` deep-link scheme;
  - a bundled offline page;
  - native notifications fed by the inbox feed, since Electron has no Web Push service;
  - code signing and notarization (macOS notifications need a signed app), and auto-update.
- **Android:**
  - the Gradle project and its signing;
  - `assetlinks.json` with the Play App Signing and upload fingerprints;
  - `enableNotifications` and the Android 13+ permission activity;
  - the Play listing.
- **iOS:** `apple-app-site-association` if there is ever a native shell; nothing for the PWA.

## 2. Native capabilities

| Capability | Web app (shared) | Desktop (Electron) | Android (TWA) | iOS PWA (later) |
| --- | --- | --- | --- | --- |
| Decision notifications | Web Push from the service worker, `tag` = request id | Main polls the inbox feed (20 s; at once on `powerMonitor` resume, focus and reconnect) and shows `Notification`s through a notifier seam that tests replace | Web Push, delegated to the app | Web Push, plain |
| Answer from the notification | `POST /w/[slug]/push/answer` with the request id and an option **index**; the server reads the label from the open request | Option buttons as actions, and `hasReply` text reply (macOS, Windows); Linux opens the decision | Up to two option buttons when the device opted in (below); any other answer opens the decision | Opens the decision |
| After answering | A replacement notification, "Sent “Okafor” to Scout", with Undo (`retractAnswer`) | The same, as a notification with an Undo action | The same | — |
| Answered elsewhere | Dispatch sends a "resolved" push that replaces the same `tag` ("Answered by Dana on desktop"), since Chrome requires every push to show something | The feed shows it closed, and main closes that notification | Replaced as on the web | Replaced |
| Deep links | `/w/[slug]/link/[id]` already redirects any id; `routes.request` focuses one request | `phean://open/<path>`, resolved against the origin and checked (§4). A single-instance lock; `open-url` on macOS, `second-instance` argv on Windows and Linux | Verified App Links for `https://<domain>/w/*` from `/.well-known/assetlinks.json` | — |
| Presence | — | A tray or menu-bar icon with the pending count, Open, Decisions and Quit. Closing hides to the tray; with no tray (GNOME without the extension) closing minimises | The launcher icon and its notification dot | The home-screen icon |
| Badge | `navigator.setAppBadge` for installed PWAs | `app.setBadgeCount` (macOS, Linux Unity), an overlay icon on Windows | Notification dots (from the OS) | The PWA badge |
| Global shortcut | — | `CommandOrControl+Shift+Alt+P` opens Decisions; changeable in the tray menu. On Wayland it needs the global-shortcuts portal; where that is missing the tray says so | — | — |
| Offline and reconnect | The service worker serves a static `/offline` page when a navigation fails, and caches nothing else | A bundled offline page (it never receives session data), retried with backoff and on `online` and resume. Feed polling backs off while offline | The service worker's offline page | Same |
| Back button | — | — | Back walks the history; at the first page it leaves the app (TWA default) | — |
| Auto-update | Web deploys | electron-updater from this repository's GitHub Releases on macOS and Windows (signature-checked, §4). On Linux, "a new version is available" opens the release page | Play Store; web content updates with each deploy | — |
| Theme and appearance | Appearance System already follows `prefers-color-scheme`. The manifest takes `theme_color` and `background_color` from `THEME_PAPER` and `themeColorFor` (Dusk) | Chromium follows `nativeTheme`. The window background and title-bar overlay follow the page's `theme-color` (`did-change-theme-color`) | Chrome follows the system; the splash takes the manifest colours | Same |

### Server work (M3), the Phean way

Push is a new adapter on the existing event channel, modelled on webhooks.

**Model: one device per person, muted per workspace.** A person turns notifications on once per device (on `/account`, or from the Decisions page), and gets every workspace they are a member of. The desktop feed works the same way. A workspace's Decisions page has a per-workspace mute. Requiring the owner to opt in on every workspace would differ from the desktop and be easy to miss.

- **Schema** (`src/server/db/schema/domain.ts`, one additive migration):
  - **`push_devices`**, a person-level table like `user`, not a tenant table:
    - `id`, `user_id` (FK, cascade);
    - `endpoint`, unique (subscribing again from the same browser upserts it onto the current person, so a shared browser never notifies the previous person);
    - `p256dh` and `auth`, encrypted with `encryptSecret` like webhook secrets;
    - `label` ("Chrome on Android"), `answer_from_notification` (boolean, default false), `private` (boolean, default false);
    - `session_id` (nullable, `on delete set null`, for display only);
    - timestamps, `last_success_at` and `failures`.
  - **`push_mutes`**: `(tenant_id, user_id)`, a tenant table with `tenantId` set from `ctx`, read through `inTenant`.
  - **`push_deliveries`**: an outbox like `webhook_deliveries` (`tenant_id`, `device_id`, `event_id`, `kind` request or resolved, `status`, `attempts`, `next_attempt_at`).
- **Lifetime is not tied to a session's expiry.** Better Auth's sessions last 7 days, refreshed daily, and an expiry cascade would stop notifications exactly when a person has been away. Instead, three things end a device:
  - Explicit sign-out, and revoking a session from `/account`, delete that session's devices. A Better Auth `before` hook on `/sign-out`, `/revoke-session`, `/revoke-sessions` and `/revoke-other-sessions` reads the affected sessions first. It is tested per path.
  - A password reset deletes every device (`revokeSessionsOnPasswordReset` is turned on as part of this).
  - A 404 or 410 from the push service deletes the device.

  At send time the recipient must still be a **member** of the workspace (memberships only, so platform admins never get pushes). The app shows "Notifications paused: sign in" when a device's person has no live session on it.
- **Policy:** a new action `notify:subscribe` in `lib/permissions.ts`, in `ACTIONS` and `member` (owner and admin inherit it). Platform admins and agents do not get it, and the service refuses agent actors as `digest.ts` does. `policy.test.ts` covers every role.
- **Services** (`src/server/domain/notifications.ts`, `service(schema, run)`):
  - **`registerDevice` and `forgetDevice`.** These are person-level, so they take a person `Ctx`. The endpoint must be `https` on a push-service host suffix (`fcm.googleapis.com`, `.push.services.mozilla.com`, `.push.apple.com`, `.notify.windows.com`). It goes through `assertWebhookUrlSafe`'s private-address check, and the key sizes are checked. `session_id` comes from the adapter's `getSession()` as a second, server-only argument, never from input. A test posts a `sessionId` field and shows it is ignored.
  - **`muteWorkspace` and `unmuteWorkspace`**, tenant-scoped.
  - **`openDecisions`**: one workspace's open requests (`selectTaskViews` on `isAwaitingInput`), lean, not the whole history. The feed adapter loops `listMemberships(db, user.id)` and builds `userContext` per tenant, so each read is scoped by its own `Ctx`.
  - **`answerInput` gains an optional `requestId`**, shaped like `RetractAnswerInput.requestId`. When it is given and the open request differs, or there is no open request, it throws `conflict`. A stale notification therefore never answers a newer question and logs no `task.input_answered`. The outcome stays `answered`, so `DELIVERED_OUTCOMES` and `collectAnswers` deliver it once.
  - **`answerFromNotification`**: takes `{ taskId, requestId, option }`. It maps the index to the open request's label and calls `answerInput`. For a `multiple` request it refuses, since those carry no buttons.
- **Routing:** `recordEvents` calls `enqueuePushes(ctx, rows)` next to `enqueueDeliveries`, in the same transaction. Recipients are the workspace's members with a device who have not muted it, excluding the actor.
  - `task.input_requested` queues a `request` push.
  - `task.input_answered`, `task.input_resolved` and the `closed` archive queue a `resolved` push to the other devices.
  - `onCommit(ctx, scheduleSendPushes)` runs only when something was queued. There is a test seam (`setPushScheduler`) like `setDispatchScheduler`, so tests never reach `waitUntil` or the network.
- **Dispatch** (`src/server/push/`):
  - The payload is built at send time from the task, read inside the tenant: request id, task id, slug, agent name (`askerName`), kind, question, and the first two options when the request is single-choice. It never carries secrets, nor more than the Decisions page shows.
  - Text is truncated to keep the payload under 3 KB, and a test checks it.
  - A `private` device gets only "A decision is waiting in Acme".
  - Each send is VAPID-signed and RFC 8291-encrypted through `web-push`, with `TTL` 24 h, `Urgency: high`, and a `Topic` header set to the request id.
  - Retries back off like webhooks and give up after a day.
  - Payloads are never logged.
  - Posting to push services is a documented exception to AGENTS.md's `postSigned` rule (the host suffix allowlist plus the private-address check). AGENTS.md is updated to say so.
  - VAPID keys are read lazily in `server/config.ts`, never at import time.
- **Cron:** `/api/webhooks/dispatch` also calls `sendDuePushes` and prunes `push_deliveries` older than 7 days.
- **Adapters (thin):**
  - **Device and mute management:** server actions in the app (`tenantAction` for the mute, and an account action for the device), rendered with `ActionForm` and `ActionButton`:
    - "Notify me on this device" is a frequent action. It takes a `notice` naming the device, with Undo.
    - "Forget this device" is rare and takes `confirm`.
    - The UI uses `Card`, one filled primary button, and the "Answer from notifications" and "Private notifications" checkboxes, each with a line of copy saying what it means on a lock screen.
  - **`POST /w/[slug]/push/answer`** is a route handler that builds its `Ctx` only through `requireWorkspace(slug)`. It needs JSON, the `Phean-Client` header (which forces a CORS preflight that no other origin passes), and an `Origin` equal to the app origin whenever an `Origin` is sent. It returns `Cache-Control: no-store`. The desktop's answers use the same rule.
  - **`GET /api/native/inbox`** takes the session cookie and a cursor. It answers `ETag`/304, `Cache-Control: no-store`, GET only, with no CORS headers. It returns `{ pending, items, minShellVersion }`.
  - **`app/manifest.ts`** and **`/offline`**. The service worker is `public/sw.js`, kept thin. Its pure parts (payload to notification options, the URL it opens, the cache list) live in `src/lib/push.ts` with unit tests. A test runs `sw.js` in a `vm` sandbox with fake `self`, `clients` and `registration`. The service worker is served with `Cache-Control: no-cache` and `Service-Worker-Allowed: /`.
- **Notification clicks** never trust a URL in a payload. The service worker and the desktop build it with `routes.request(slug, requestId)` from the ids, check it is same-origin, and focus an existing client of the same origin only.
- **Routes:** `routes.offline`, `routes.pushAnswer(slug)`, `routes.nativeAuthorize`, `routes.nativeInbox`.
- **Tests:**
  - Domain: register, re-register from another person, forget, mute, recipients, stale request id, sign-out and revoke hooks, the password-reset purge, payload size, the private payload.
  - `isolation.test.ts`:
    - workspace A's events never reach B's members;
    - B's member cannot answer A's request through B's answer URL;
    - the feed never shows another workspace;
    - former members and platform admins get no push.
  - `policy.test.ts`: `notify:subscribe` per role.
  - Dispatch against a fake push endpoint.
  - e2e: the device panel and mute; `/offline` and the device panel go into `PAGES` and `PANELS` in `e2e/quality.spec.ts`.

## 3. Auth

- **Android (TWA):** nothing new. It is Chrome, with the same cookies, provider sign-in, account linking and two-factor challenge (`providerSignInChallenge`) as the web.
- **Desktop, password sign-in:** in the app window, as on the web. The two-factor plugin challenges as usual.
- **Desktop, GitHub, Google, linking a provider, and password reset: a browser handoff over a loopback redirect** (RFC 8252 §7.3). The app never shows a provider's page, and the navigation allowlist would block one anyway.
  1. The app shows "Continue with GitHub in your browser". The sign-in page detects the desktop app by `window.pheanDesktop` and calls `pheanDesktop.signInWithBrowser("github")`.
  2. Main starts a one-shot HTTP listener on `127.0.0.1` at a random port. It makes a PKCE verifier (32 random bytes) and a `state`.
  3. Main **registers the request first**: `POST /api/auth/native/start` with `{ code_challenge, redirect_uri: "http://127.0.0.1:<port>/callback", state }`. The server stores a request id with a two-minute lifetime and returns it, with a four-character confirmation code that both the app window and the browser page show.
  4. Main opens the system browser at `https://<origin>/native/authorize?request=<id>` (`shell.openExternal`, after §4's URL check).
  5. In the browser the person signs in however they like. Every path reaches a full session only after two-factor: the plugin challenges password sign-ins, and `providerSignInChallenge` challenges provider callbacks. A pending challenge is not a session.
  6. `/native/authorize` requires a full session and an unexpired, unused request id; it refuses an authorize the app did not start. It shows "Sign in to Phean desktop as Dana? Check the app shows code K7QM" with one button. The click is a server action. It stores a one-time code (32 random bytes, hashed in Better Auth's `verification` table, bound to the request, the user and the challenge, compared in constant time), then hands off to a **route handler that answers 303** to the loopback `redirect_uri`. It is not a server-action `redirect()`, and there is no CSP `form-action` on that path (§4).
  7. The loopback listener takes one request, checks `state`, answers with a static "You can close this tab" page, and closes.
  8. Main posts `{ request, code, code_verifier }` as JSON with `Phean-Client: desktop` to `POST /api/auth/native/exchange` through the app's session (`session.fetch`). That endpoint is a small Better Auth plugin.
     - It refuses any request that carries a browser `Origin` or `Sec-Fetch-Site`, any request without the JSON body and the header, and any request that already has a session cookie. A page therefore cannot use it for a login CSRF.
     - It creates the session with Better Auth's own helpers, with the user agent "Phean desktop", so `/account`'s session list names it.
     - It returns the cookie. Main sets it in the `persist:phean` partition with `session.cookies.set` (an M1 test proves it lands there), so the design does not depend on `session.fetch`'s cookie handling.
  - **Both ends are rate limited**, per user and per address. Codes are single use. Minting a native session is logged in the server log; events are per workspace and this is per person.
  - A malicious `phean://` handler gains nothing. The callback is loopback, the code needs the verifier held in main's memory, and the authorize step needs a request id the real app registered and a confirmation code the person can compare.
  - Tests cover several cases: a two-factor-pending browser at `/native/authorize`, an unknown or expired request, a replayed code, a wrong verifier, an exchange with a browser `Origin`, and an exchange while signed in.
  - The same endpoints serve an iOS shell later through `ASWebAuthenticationSession`.
- **Session storage.**
  - **Desktop:** Better Auth's cookies live in a persistent partition, `persist:phean`. With the `EnableCookieEncryption` fuse, Chromium encrypts them at rest with the OS keychain (macOS Keychain, Windows DPAPI). On Linux it uses libsecret only when a keyring is present; otherwise the key is effectively fixed. The app checks `safeStorage.getSelectedStorageBackend()`, and on `basic_text` it says so in the tray and offers shorter sessions. No token goes in a plain file, and the app stores only window bounds and preferences.
  - **Android:** Chrome's own cookie store.
- **Sign-out and revocation.**
  - Sign-out is the web's. The desktop also clears the partition's storage and stops polling.
  - Signing out, or revoking a session from `/account`, deletes its push devices (§2), and the device's next request lands on sign-in.
  - Leaving a workspace stops its notifications at send time.
  - The feed answers 401 for a dead session, and the desktop shows the signed-out state in the tray. An M1 test signs out on the web and watches the desktop's feed get 401.

## 4. Security checklist

Each item is ⬜ (to verify) until it has evidence (a test, a config line or a review), and then becomes ✅.

### Electron
- ⬜ Every window has `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `nodeIntegrationInSubFrames: false`, `webviewTag: false` and `webSecurity: true`. A unit test asserts the options, and the Playwright smoke test reads `typeof process` and `typeof require` from the page (`undefined`).
- ⬜ A minimal typed preload (`contextBridge`): `signInWithBrowser(provider)`, `version`, `platform`. Every IPC handler requires `event.senderFrame` to be non-null and to equal `webContents.mainFrame`, and requires `new URL(senderFrame.url).origin` to be the Phean origin. The offline page may call only `retry` from `app://offline`. There is no generic `send` or `invoke` passthrough.
- ⬜ Navigation: `will-navigate`, `will-redirect` and `will-frame-navigate` allow only the exact Phean origin (scheme, host, port). `setWindowOpenHandler` denies every new window and hands http(s) URLs to the external opener. Every `loadURL` goes through the same origin check, since `loadURL` fires no `will-navigate`.
- ⬜ `shell.openExternal` is called only for `https:` (and `http:` to loopback in development), after `new URL()` parsing, with credentials refused. Agent links (`OutsideLink`, `target="_blank"`) therefore always leave for the system browser and never load in a privileged window.
- ⬜ `setPermissionRequestHandler` and `setPermissionCheckHandler` deny everything except `clipboard-sanitized-write` for the Phean origin. Notifications are shown by main, not by the page.
- ⬜ Fuses, set at package time and read back in CI with `npx @electron/fuses read`:
  - off: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`, `GrantFileProtocolExtraPrivileges`;
  - on: `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` (asar integrity is enforced on macOS and Windows), and `EnableCookieEncryption`.
- ⬜ No `@electron/remote`. No `file://` content: the offline page is served by a privileged `app:` scheme with a fixed file map and `default-src 'none'; style-src 'self'`. DevTools are disabled in packaged builds.
- ⬜ Deep links: only `phean://open/<path>`. Main builds `new URL(path, origin)` and accepts the result only if its `origin` is Phean's, its normalised `pathname` starts with `/w/`, `/workspaces` or `/account`, and the raw path passes `safeNextPath`.
  - A reviewer found that `safeNextPath` accepted `"/\t/evil.com"`, which a browser resolves to another origin, and that is an open redirect on the web today. It is fixed in its own PR (#57).
- ⬜ Protocol registration and argv: the protocol is registered with a `--` separator before the URL. From `process.argv` and `second-instance`, main reads only the one argument starting with `phean://` and ignores everything else, which closes the CVE-2018-1000006 class of argv injection.
- ⬜ The loopback listener binds `127.0.0.1` only, accepts one request to `/callback` within two minutes, checks `state`, and closes.
- ⬜ Signed updates:
  - **macOS:** signed and notarized; Squirrel.Mac checks the signature.
  - **Windows:** signed; electron-updater checks `publisherName`.
  - **Both:** the `latest*.yml` sha512 is checked, but the yml itself is not signed, so the OS signature is the real check.
  - **Linux AppImage:** there is no signature check, so Linux does not self-update; it links to the release.
  - **Releases:** updates come only from this repository's GitHub Releases, with the owner and repo pinned in the app. Releases are immutable, and the publish token is limited to the protected `release` environment.
- ⬜ Electron stays within the three supported majors: a CI check fails when `electron`'s major is more than two behind `npm view electron version`.
- Tauri's equivalent, had it been chosen, would be minimal capabilities with a `remote.urls` scope of the one origin.

### Android (TWA)
- ⬜ No WebView in the app and no JavaScript bridge. When no TWA-capable browser is installed, the fallback is a Custom Tab (`fallbackType: customtabs`), never a WebView.
- ⬜ `android:usesCleartextTraffic="false"`, and a network security config with `cleartextTrafficPermitted="false"`.
- ⬜ Verified App Links: an `android:autoVerify="true"` intent filter for `https://<domain>/w/` only. Phean serves `/.well-known/assetlinks.json` as `application/json` with no redirect, outside the sign-in proxy, built from `PHEAN_ANDROID_CERT_SHA256` with the Play App Signing and upload fingerprints (public values). A unit test covers it.
- ⬜ Exported components are only the launcher activity (`LauncherActivity`) and `DelegationService`, which Chrome must bind to for notification delegation; android-browser-helper verifies that the caller is the verified browser. Everything else (`NotificationPermissionRequestActivity`, the provider) is `exported="false"`. CI lints the merged manifest for exactly this list.
- ⬜ Permissions: `INTERNET` and `POST_NOTIFICATIONS` only. No storage, camera or location.
- ⬜ `allowBackup="false"`.
- ⬜ No committed keystore for any build that production's `assetlinks.json` trusts. A debug key's fingerprint is listed only in a preview or local environment, never in production, because anyone with that key could ship an app verified for Phean's domain.

### Web app (affects every platform)
- ⬜ The service worker handles navigations only, never caches a response or a redirect, serves only the precached static `/offline`, and handles `push` and `notificationclick`. It is served with `Cache-Control: no-cache`. Tests run it in a `vm` sandbox.
- ⬜ CSP: a baseline header on app pages (`object-src 'none'; base-uri 'self'; frame-ancestors 'none'; worker-src 'self'`), added per path in `next.config.ts` like the existing `/oauth/:path*` headers.
  - There is **no `form-action`**: Chrome applies it to the redirects after a form post, which would break `/oauth/approve` (`cursor://`, `vscode://`, loopback) and the handoff.
  - An e2e runs the OAuth consent redirect under the new header.
  - A nonce-based `script-src` is a follow-up; it needs nonces wired through the root layout.
- ⬜ Answer endpoints require JSON plus the `Phean-Client` header plus a same-origin `Origin` whenever one is sent. They take a request id and an option index, never a label or a URL, and run through `answerInput`.
- ⬜ Push payloads carry the event only. They are encrypted end to end, truncated, never logged, and minimal on `private` devices. Answering from a notification is opt-in per device, because a lock screen may show the buttons.
- ⬜ Agent-supplied URLs are never fetched by the server or the shell. Agent text in notifications is plain text (the Notifications API renders no HTML), and in the app it goes through `OutsideLink` and `MarkdownView` as today.

### Release
- ⬜ Dependencies are pinned exactly in `apps/desktop` (no ranges), with the lockfile committed. `pnpm audit` covers all dependencies, Electron included, which is a devDependency, so `--prod` would skip it. Dependabot is set up for `apps/desktop` (npm), `apps/android` (gradle) and GitHub Actions, with Electron majors grouped.
- ⬜ Signing keys never enter the repository. The Apple Developer ID certificate and notarization API key, the Windows signing credentials (Azure Trusted Signing), the Android upload key and the Play service account live in GitHub Actions secrets of a `release` environment with required reviewers, or on the owner's machine. Play App Signing holds the Android app signing key.
- ⬜ Release builds run only from `desktop-v*` and `android-v*` tags on `main`, in the protected `release` environment.

## 5. Repository layout and tooling

```
apps/
├── desktop/            # Electron shell: own package.json and pnpm-lock.yaml, TypeScript strict
│   ├── src/main/       # window, security, deep links, loopback handoff, tray, shortcut, feed poller, notifier, updater
│   ├── src/preload/    # the typed contextBridge API
│   ├── static/         # offline page, icons
│   ├── tests/          # vitest: URL and deep-link checks, argv parsing, feed diffing, window options, the import graph
│   └── e2e/            # Playwright `_electron` smoke test against a local Phean (next start)
└── android/            # TWA: a Gradle project on android-browser-helper, plus twa-manifest.json
docs/apps/              # this plan, per-platform READMEs, local-task prompts
```

- **The apps are not root workspace members.** There is no `pnpm-workspace.yaml`. `apps/desktop` has its own lockfile and is installed with `pnpm --dir apps/desktop install`, so:
  - The root `pnpm install` (Vercel's) never downloads Electron.
  - The root needs `"apps"` in `tsconfig.json`'s `exclude` (`next build` typechecks `**/*.ts`) and `"apps/**"` in eslint's `globalIgnores`. `vitest.config.ts` and `playwright.config.ts` already skip `apps/`.
  - `.vercelignore` drops `apps/`, and `vercel.json` gets an `ignoreCommand` so that commits touching only `apps/` or `docs/apps/` do not deploy.
  - `apps/desktop` sets `pnpm.onlyBuiltDependencies: ["electron", "esbuild"]`, or pnpm 10 skips Electron's binary download.
- **Shared code.** Only named client-safe files from `src/lib` are shared: `routes.ts` and `links.ts`, with what they import (`task-views.ts`, `domain.ts`). Main imports them by relative path, and esbuild bundles them. A test walks the bundle's inputs and fails on anything under `src/server`, or on `react` and `better-auth`. The desktop and the web therefore never disagree on a path.
- **Desktop tooling:**
  - TypeScript strict, with the root's flags including `noUncheckedIndexedAccess`; an ESLint flat config; vitest.
  - A Playwright `_electron` smoke test under `xvfb-run`. It launches the app against a local Phean, signs in with the seeded demo account, opens a deep link, and reads the window's security settings from the page. Through the notifier seam (CI cannot see a native toast) it checks that the feed fires a notification and that an action answers it.
  - `pnpm --dir apps/desktop check` mirrors the root's. The desktop's tests do not run in the root `pnpm check`; `apps.yml` runs them.
- **Android tooling:**
  - CI runs `./gradlew lint assembleDebug` and a manifest check of the exported components.
  - An emulator job (`reactivecircus/android-emulator-runner`, KVM on Ubuntu) installs the APK and checks that it launches. It stays non-blocking until it proves stable. Verification of Digital Asset Links is checked on the phone (local task 02), since a CI debug key is never trusted by production.
- **CI** is `.github/workflows/apps.yml`, path-filtered to `apps/**`, `docs/apps/**` and the push code:
  - **Desktop:** `check`, Linux packaging and the smoke test on Ubuntu; unsigned packaging on macOS and Windows runners, with no secrets on PRs; the Electron support-window check.
  - **Android:** `lint assembleDebug`, plus the emulator job.
  - The existing `ci.yml` keeps running `pnpm check` and `pnpm test:e2e` unchanged.
- **Versioning and channels:**
  - **Desktop:** versioned on its own in `apps/desktop/package.json`, starting at `0.1.0`, tagged `desktop-v*`. Prereleases (`-beta.N`) feed a beta channel through electron-updater's `channel`.
  - **Android:** tagged `android-v*`, with `versionCode = major * 10000 + minor * 100 + patch`; Play internal testing first, then production.
  - **Contract between shell and server:** the feed returns `minShellVersion`, and a shell older than that shows "Update Phean". The server keeps `/api/auth/native/*` and `/api/native/inbox` backward compatible for at least the two latest shell minors, and changes them only additively.

## 6. Milestones

**M0, the plan.** This document, reviewed by three independent reviewers, with the decisions recorded in §8. Acceptance: committed on `claude/native-apps`, draft PR #56 open.

**M1, the desktop shell: signed in and usable, with deep links.** Acceptance:
- `apps/desktop` builds and runs on Linux in CI, and runs unsigned on the owner's machine (local task 01).
- It opens the configured origin (`PHEAN_DESKTOP_ORIGIN`, defaulting to production).
- Sign-in works with a password (two-factor included), and with GitHub or Google through the loopback handoff. The session survives a restart; the test checks the cookie in `persist:phean`.
- `phean://open/w/<slug>/link/<id>` focuses the running app on that object; a second launch focuses the first.
- The tray has Open, Decisions and Quit. The global shortcut opens Decisions. The offline page shows within 2 s of losing the server, and the app recovers within 10 s of it returning.
- Signing out on the web makes the feed answer 401, and the tray shows signed out.
- Every Electron item in §4 is ✅. The smoke test is green in CI, and the root's `pnpm check`, `pnpm build` and `pnpm test:e2e` stay green.

**M2, the Android app: signed in and usable, with App Links.** Acceptance:
- `apps/android` builds and lints in CI.
- The web gets a manifest, the service worker, `/offline` and `assetlinks.json`, covered by `pnpm test:e2e` and unit tests.
- A release build on Play internal testing (local tasks 03 and 05) opens full screen with no URL bar on the owner's phone.
- Sign-in with a password, GitHub, Google and two-factor all work there.
- `https://<domain>/w/<slug>/link/<id>` opened from another app lands in Phean.
- Back at the first page leaves the app.

**M3, Decision notifications on both, with the server side.** Acceptance:
- **Android:** an agent's `request_input` reaches the owner's phone within 10 s at p95 over 20 tries. The Android 13+ permission prompt appears from "Notify me on this device".
- **Desktop:** the request reaches the desktop within 25 s (on Linux and Windows, and on macOS once signed, since macOS notification APIs need a code-signed app; macOS signing from M4 is pulled in for this).
- **Answering:** with "Answer from notifications" on, an option tap answers, the agent's `wait_for_answers` returns that answer, and an "answered" notification with Undo replaces the original. Tapping the body opens the request in the app, not in Chrome.
- **Stale and elsewhere:** a stale notification answers nothing and says so. An answer on one device replaces the notification on the other.
- **Server:** the schema, services, routing, dispatch and adapters of §2, with their domain, isolation, policy and e2e tests. This part is purely additive and may merge first, by the owner.

**M4, auto-update and the release pipeline.** Acceptance:
- Tagging `desktop-v0.x.y` builds, signs and notarizes macOS, signs Windows, builds the Linux AppImage, and publishes an immutable GitHub Release.
- An installed older build on macOS or Windows updates itself and restarts. An update with a valid yml but an unsigned binary is refused. Linux shows the "new version" link.
- `android-v*` builds a signed AAB and uploads it to Play internal testing.
- Dependabot is live, and the release environment requires the owner's approval.

**Later, iOS.** First the home-screen PWA with Web Push: no new code, and a check of the `/offline` page and notifications on an iPhone. Then a native shell, only if App Store presence is wanted (§1).

## 7. What this cloud session cannot do

These are self-contained prompts for a local session on the owner's machine, in [`local-tasks/`](local-tasks/). None of them involves pasting a secret anywhere. Secrets go straight from the owner's machine into Vercel, GitHub Actions secrets or the OS keychain.

| Task | Prompt |
| --- | --- |
| Run the desktop app on macOS or Windows and check it end to end | [`01-desktop-local-check.md`](local-tasks/01-desktop-local-check.md) |
| An accelerated Android emulator, and the real phone | [`02-android-device-check.md`](local-tasks/02-android-device-check.md) |
| VAPID keys and Android fingerprints into Vercel | [`03-vercel-push-and-app-links.md`](local-tasks/03-vercel-push-and-app-links.md) |
| Code signing and notarization secrets into GitHub | [`04-desktop-signing.md`](local-tasks/04-desktop-signing.md) |
| The Android upload key and the Play listing | [`05-play-store.md`](local-tasks/05-play-store.md) |

FCM and APNs credentials are not needed for the chosen approach, since Web Push uses VAPID. They come back only with a native shell.

## 8. Decisions and rejected options

| Decision | Chosen | Rejected, and why |
| --- | --- | --- |
| Shell or bundled client | A shell around the hosted origin, web-first (the governing principle) | A bundled client: a second front end and an API, for an app whose value is the existing pages. It also fails the owner's web-first rule, since every new surface would need app work |
| Navigation allowlist | By origin, so any present or future page loads | By path: every new page would need a shell release |
| Desktop | Electron 45 with electron-builder and electron-updater | Tauri: WebKitGTK's performance and version spread, no Playwright, and Rust. Electron Forge: the Squirrel updater has no Linux |
| Android | A TWA | Capacitor: an embedded-webview sign-in workaround, FCM credentials, and a bridge exposed to a remote origin. Tauri mobile: the same, plus no first-party push |
| iOS | A home-screen PWA first | Capacitor by default: no Web Push in WKWebView (APNs needed), `server.url` not meant for production, App Store guideline 4.2 risk |
| Push | Web Push with VAPID | FCM directly: a Firebase project and credentials for no gain while Android is a TWA |
| Push model | One device per person across all their workspaces, with per-workspace mutes (review) | One subscription per workspace: it differs from the desktop feed and is easy to miss on a new workspace |
| Device lifetime | Ended by sign-out, revoke, password reset or a 410, with membership checked at send time (review) | Cascading from the session row: Better Auth's 7-day expiry would silently stop notifications after a week away |
| Desktop notifications | Polling a person-scoped feed every 20 s, with an ETag | Web Push in Electron: Electron has no push service. Reusing `/api/events`: it takes only agent bearers, so a person credential would be a new auth path, and each connection holds a 270 s function, so one per device around the clock costs more than a cheap poll (review) |
| Desktop sign-in handoff | A loopback redirect, with the request registered by the app and a confirmation code shown on both sides (review) | A `phean://` callback with PKCE alone: PKCE does not stop an attacker starting the flow and phishing the click, and any app can claim the scheme |
| Exchange endpoint | JSON only, with `Phean-Client`, refusing browser `Origin`, `Sec-Fetch-Site` or an existing session (review) | An open POST: a login CSRF into the attacker's account |
| Notification answers | Option index plus request id; the server reads the label; `answerInput` checks the request id; Undo afterwards (review) | Labels or URLs from the payload; answering by task id alone, where a stale notification could answer a newer question |
| Lock screen | Answering from notifications and private payloads are per-device choices, answering off by default (review) | Always showing buttons: Web Push cannot hide them on a lock screen |
| CSP | Baseline per-path headers without `form-action` (review) | A global `form-action`: it breaks the OAuth client redirects and the handoff |
| Linux auto-update | A "new version" link | electron-updater on AppImage: nothing verifies the binary beyond an unsigned yml (review) |
| Android exported components | The launcher and `DelegationService` (review) | "Only the launcher": notification delegation would silently not work |
| Repo layout | `apps/*` with their own lockfiles, excluded from the root's tsconfig and eslint, `.vercelignore`, and `ignoreCommand` | A root pnpm workspace: Vercel's install would pull Electron, and the root build would change |
| Debug signing | The owner's local debug key, trusted only in preview or local environments | A committed debug keystore trusted by production: anyone could ship an app verified for the domain (review) |

### Review findings not taken, or deferred
- **A WebSocket for people:** deferred (see the push-model row above). It can be revisited if Phean moves people to a stream.
- **Shorter sessions on Linux without a keyring:** offered as a choice in the tray, not forced.
- **A nonce-based `script-src`:** deferred to after M1, because it touches the root layout for every page. Until then the minimal bridge and the origin allowlist limit what an XSS on the origin could reach.
