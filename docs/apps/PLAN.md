# Phean native apps: plan

Status: draft for review (M0). Owner reviews and merges every native-app PR.

Phean people mostly do one thing: answer the Decisions agents are waiting on. The native apps exist to make that faster than a browser tab can: a notification the moment an agent asks, an answer in one or two taps, and Phean one keystroke away on the desktop. Everything else (tasks, goals, documents) is the hosted web app, which already has responsive layouts down to 375px.

The owner uses the **desktop app** and the **Android app**. Those come first and must be excellent. **iOS** comes later and should cost little.

## 1. Approach

### What was checked (2026-11-21, from the npm registry and project release pages)

| Option | Current version | Maintenance |
| --- | --- | --- |
| Electron | 45.4.1 (45.0.0 shipped 2026-10-21; 44.0.0 2026-08-25; 43.0.0 2026-06-30) | A major every 8 weeks; the latest three majors get security fixes, so an app must move a major at least every ~6 months |
| electron-builder / electron-updater | 26.18.0 / 6.8.11 (both published 2026-11-21) | Active, weekly releases |
| Electron Forge | 8.0.1 (2026-09-29) | Active; official, but its updater is Squirrel (no Linux) |
| @electron/fuses | 2.1.3 | Active |
| Capacitor (core, android, push-notifications, app) | 8.6.2, 8.6.2, 8.1.3, 8.1.2 (8.0.0 shipped 2025-12-08) | Active, monthly minors |
| Tauri 2 (cli, api) | 2.12.6, 2.12.5 (2.0.0 shipped 2024-10-02, 2.12.0 2026-09-26) | Active, minors every 2-5 months |
| Bubblewrap (TWA generator) | 1.27.0 (2026-10-09) | Active, from GoogleChromeLabs |
| web-push (VAPID, RFC 8291 encryption) | 4.0.0 (2026-11-06) | Active again after a long 3.x line; pin exactly |
| Playwright | 1.65.1 (root uses ^1.64.1) | Has first-class Electron support (`_electron.launch`) |

Versions must be re-read with `npm view <pkg> version` when the code lands; this table is the evidence for the decision, not a pin.

### The constraint that decides it

Phean's web app is server-rendered (App Router, server components, server actions, cookie sessions). There is no static client to bundle, so every option is a **shell around the hosted origin**. A bundled client would mean a second front end and an API for it: rejected as the most expensive option by far.

Inside a shell, the hard problems are the same three on every platform: **provider sign-in** (Google refuses OAuth in embedded webviews; GitHub increasingly does too), **push notifications** (need a push service and server work), and **the security of a privileged bridge** exposed to web content that shows agent-written text.

### Options weighed

**A. Electron (desktop) + Capacitor (Android, iOS), both loading the hosted origin.**
- Electron: the strongest desktop story. Tray, badge, global shortcut, native notifications with actions (and inline reply on macOS), a mature signed auto-updater (electron-updater: NSIS on Windows, DMG/ZIP on macOS, AppImage on Linux), one Chromium everywhere (the Liquid Glass `backdrop-filter`, `oklch` tokens and fonts render as in Chrome), and Playwright drives it in CI. Costs: ~100 MB installers, a major upgrade every 8 weeks, and a large attack surface that must be locked down (§4).
- Capacitor on Android: Android System WebView, so provider sign-in must leave the webview (Custom Tab, then an App Link back, then a code exchange into the webview's cookie jar). Native FCM push via `@capacitor/push-notifications` needs a Firebase project, `google-services.json` and server-side FCM credentials. Capacitor's own docs describe `server.url` (loading a remote origin) as meant for live reload, not production; with it, the Capacitor bridge and every installed plugin are callable by the remote page.

**B. Tauri 2 everywhere.** One Rust core, the system webview on each platform, capability files that scope what the page may call. Smaller binaries and a tighter default posture. But:
- On Android it is the same System WebView as Capacitor, so the same sign-in workaround is needed, and there is no first-party push plugin (community FCM plugins only).
- On desktop the webview differs per OS (WebView2, WKWebView, WebKitGTK). WebKitGTK lags on `backdrop-filter` and `oklch`, which the design system leans on, and Playwright cannot drive it; Tauri's WebDriver support covers Linux and Windows only.
- A Rust toolchain and a second language for a team that is all TypeScript.
- "One codebase" is the selling point, and it shrinks once Android is not a webview app (below).

**C. Installable PWA as the base layer, a Trusted Web Activity (TWA) on Android.**
- A TWA is a thin Android app that opens the verified origin in **Chrome itself**, full screen, with no URL bar once Digital Asset Links verify. Because it is Chrome, not a webview: Google and GitHub sign-in, password managers, passkeys and the two-factor challenge work exactly as on the web, with no auth code at all. There is no JavaScript bridge to secure. App Links are the same Digital Asset Links file. Notifications are **Web Push** from the PWA's service worker; Chrome delegates them to the TWA so they show under Phean's name and icon, with up to two action buttons, and the launcher badges them.
- Web Push needs only a VAPID key pair on the server; no Firebase project, no `google-services.json`, no FCM server key. The same Web Push code serves desktop browsers and, later, iOS home-screen web apps (Safari 16.4+).
- Limits: no inline *text* reply in a Web Push notification (buttons only), it needs Chrome (or another TWA-capable browser) on the device, and native features beyond the web platform need a native plugin later.

### Recommendation

**A PWA base layer, Electron for desktop, a TWA for Android, and iOS later as a home-screen PWA first and a Capacitor shell only if App Store presence is wanted.**

| Layer | What it is | Why |
| --- | --- | --- |
| Web app (shared) | Web app manifest, a minimal service worker (offline page + Web Push, never caching signed-in pages), a push subscription service, an answer-from-notification endpoint, a person-scoped inbox feed | Written once in the existing Next.js app, under the existing rules; every platform and every browser benefits |
| Desktop | Electron 45 shell around the hosted origin, electron-builder + electron-updater | The owner's suggestion holds up: it is the only option with tray, badge, global shortcut, signed auto-update and Playwright e2e on all three OSes with one renderer |
| Android | TWA generated with Bubblewrap's library (`android-browser-helper`), checked in as a small Gradle project | Sign-in, 2FA and App Links for free, no bridge to secure, Web Push without FCM credentials; the least code and the smallest attack surface |
| iOS (later) | First the PWA (Add to Home Screen, Web Push). Then, only if needed, Capacitor 8 reusing the desktop's browser sign-in handoff and the same Web Push/APNs server seam | Costs nothing until App Store presence matters |

**Rejected:** Tauri (the shared-codebase benefit disappears once Android is a TWA, and WebKitGTK plus no Playwright weakens the desktop, which is the one platform it would own); Capacitor for Android now (the embedded-webview sign-in workaround, FCM credentials and a bridge exposed to a remote origin, for one feature the TWA lacks: inline text replies); a bundled client (a second front end).

**Revisit when:** the owner wants inline text replies on Android (then a Capacitor or small native Android app, reusing the handoff endpoint from M1 and adding an FCM sender behind the same push service), or Chrome changes TWA support.

### What each platform still needs on its own

- **Desktop:** the tray and badge, the global shortcut, the `phean://` scheme, the browser sign-in handoff, a bundled offline page, native notifications fed by the inbox feed (Electron has no Web Push service), code signing and notarization, auto-update.
- **Android:** the Gradle project and its signing, `assetlinks.json` with the signing certificate's fingerprint, the notification permission prompt (Android 13+), the Play listing.
- **iOS:** an Apple developer account, Universal Links (`apple-app-site-association`), and, for Capacitor, the APNs sender.

## 2. Native capabilities

| Capability | Web app (shared) | Desktop (Electron) | Android (TWA) | iOS (later) |
| --- | --- | --- | --- | --- |
| Decision notifications | Web Push from the service worker, tagged by request id | Main process polls the inbox feed (30 s, and at once on resume, focus and reconnect) and shows `Notification`s | Web Push, delegated to the app | Web Push for a home-screen PWA (16.4+), APNs if Capacitor |
| Answer from the notification | `POST /api/push/answer` (session cookie, origin checked) runs `answerInput` with the request id it was shown | Option buttons as notification actions (macOS, Windows), `hasReply` text reply on macOS; Linux opens the decision | Up to two option buttons; any other answer opens the decision | Buttons in the PWA; text reply with a native shell |
| Deep links | `/w/[slug]/link/[id]` already redirects any id; `routes.request` focuses one request | `phean://open/<path>` mapped to the origin after a path check; single-instance lock; `open-url` (macOS), `second-instance` argv (Windows, Linux) | Verified App Links for `https://<domain>/w/*` via `/.well-known/assetlinks.json` | Universal Links via `/.well-known/apple-app-site-association` |
| Presence | — | Tray (or menu bar) icon with the pending count, Open, Decisions, Quit; close hides to tray | Launcher icon and notification badge (by the OS) | Same as Android |
| Badge | `navigator.setAppBadge` for installed PWAs | `app.setBadgeCount` (macOS, Linux Unity), overlay icon on Windows | Notification dots | PWA badge |
| Global shortcut | — | `CommandOrControl+Shift+Alt+P` opens Decisions (changeable in the tray menu; shown in the tray and app menu) | — | — |
| Offline and reconnect | Service worker serves a static `/offline` page when a navigation fails; nothing signed-in is cached | Bundled offline page on load failure, retried with backoff and on `online`/resume; feed polling backs off while offline | The service worker's offline page | Same as Android |
| Auto-update | Web deploys | electron-updater from GitHub Releases, signature-checked (§4) | Play Store; web content updates with each Vercel deploy | App Store |
| Theme and appearance | Appearance System already follows `prefers-color-scheme`; `theme-color` meta from `themeColorFor` | Chromium follows `nativeTheme`; the window's background and title bar overlay follow the page's `theme-color` (`did-change-theme-color`) | Chrome follows the system; the manifest's `theme_color`/`background_color` for the splash | Same |

### Server work (M3), the Phean way

Push is a new adapter on the existing event channel, mirrored on webhooks and digests:

- **Schema** (`src/server/db/schema/domain.ts`, one migration, additive):
  - `push_subscriptions`: `id`, `tenant_id` (FK, cascade), `user_id` (FK, cascade), `session_id` (FK to Better Auth's `session`, **on delete cascade**, so signing out or revoking a session on `/account` stops that device's notifications), `endpoint` (unique per tenant), `p256dh`, `auth` (the subscription keys, stored encrypted like webhook secrets), `label` (from the user agent: "Chrome on Android"), timestamps, `last_success_at`, `failures`. Per workspace, like `digest_subscriptions`, because notifications are per workspace and tenant scoping comes from `Ctx`.
  - `push_deliveries`: an outbox like `webhook_deliveries` (`tenant_id`, `subscription_id`, `event_id`, `status`, `attempts`, `next_attempt_at`).
- **Policy:** a new action `notify:subscribe` in `lib/permissions.ts`, held by owner, admin and member (people only, like `digest:subscribe`); `policy.test.ts` covers every role.
- **Services** (`src/server/domain/notifications.ts`, `service(schema, run)`):
  - `subscribePush` / `unsubscribePush` (validates the endpoint is `https` on a known push service host list, the keys' sizes; tenant from `ctx`, user and session from the session).
  - `listNotificationSubscriptions` for the "This device" panel.
  - `inboxFeed` for the desktop: the open requests across the person's workspaces since a cursor, plus the pending count (reads through `listDecisions`-style queries in each tenant's `Ctx`).
  - `AnswerInput` gains an optional `requestId`; when given and it is not the open request's id, `answerInput` throws `conflict`, so a stale notification never answers a newer question. Additive, tested.
- **Routing:** `recordEvents` calls `enqueuePushes(ctx, rows)` next to `enqueueDeliveries`, in the same transaction, for `task.input_requested` (and `goal.proposed` once approvals join). Recipients are the tenant's current members with a subscription, excluding the actor; the payload is the event (request id, task id, slug, agent name, the question, up to the first two options, the URL from `routes.request`), never secrets. `onCommit` kicks `dispatchPushes`; the existing per-minute cron sweeps retries.
- **Dispatch** (`src/server/push/`): VAPID-signed, RFC 8291-encrypted POSTs through `web-push`, with a fixed allowlist of push service hosts (Google FCM, Mozilla autopush, Apple, Windows WNS), `TTL` of 24 h, `Urgency: high`; 404/410 deletes the subscription; membership is re-checked at send time; retries back off like webhooks and give up after a day.
- **Adapters:** `POST/DELETE /api/push/subscriptions` and `POST /api/push/answer` route handlers (session cookie, `Origin` must be the app origin), a `GET /api/native/inbox` handler, and a "Notifications on this device" control on the Decisions page and on `/account`, through `ActionForm`/`ActionButton`, with copy that names the device.
- **Tests:** domain tests (subscribe, unsubscribe, routing recipients, stale request id, session cascade), `isolation.test.ts` (a subscription in workspace A never receives B's events; B's member cannot list or delete A's subscriptions; the feed never shows another workspace), `policy.test.ts` (`notify:subscribe` per role), dispatch tests against a fake push endpoint, and an e2e for the Decisions page control.

## 3. Auth

- **Android (TWA):** nothing new. It is Chrome: the same cookies, provider sign-in, account linking and two-factor challenge (`providerSignInChallenge`) as the web.
- **Desktop, password sign-in:** in the app window, as on the web; the two-factor plugin challenges as usual.
- **Desktop, GitHub and Google: a browser handoff.** The app never shows a provider's page.
  1. The sign-in page, seeing the desktop app (its user agent ends with `PheanDesktop/<version>`, and `window.pheanDesktop` exists), turns "Continue with GitHub" into "Continue with GitHub in your browser", which calls `pheanDesktop.signInWithBrowser("github")`.
  2. Main makes a PKCE verifier (32 random bytes) and a `state`, and opens the system browser at `https://<origin>/native/authorize?client=desktop&provider=github&state=…&code_challenge=…` (`shell.openExternal`, after the URL check in §4).
  3. In the browser, the person signs in however they like. Every path ends at a full session only after two-factor: the plugin challenges password sign-ins, `providerSignInChallenge` challenges provider callbacks. `/native/authorize` requires a full session and shows "Sign in to Phean desktop as Dana?" with one button. The click (a server action) prevents a login-CSRF where a page silently signs the app into someone else's account.
  4. The action stores a one-time code (32 random bytes, hashed in Better Auth's `verification` table, 2-minute lifetime, single use, bound to the user and the code challenge) and redirects to `phean://auth/callback?code=…&state=…`.
  5. Main checks `state`, then posts `{ code, code_verifier }` to `POST /api/auth/native/exchange` through the app's own session (`session.fetch`), so the response's `Set-Cookie` lands in the app's cookie jar. The endpoint is a small Better Auth plugin, so it creates the session and sets the cookie with Better Auth's own helpers (`internalAdapter.createSession`, `setSessionCookie`); the new session is a full one because the browser's was.
  6. Another app that registers `phean://` and catches the code cannot use it without the verifier, which never leaves main's memory.
  - Any new sign-in path ends in the two-factor challenge (AGENTS.md): this one mints a session only from a session that already passed it. Tests cover a pending-challenge browser session being refused at `/native/authorize`.
  - The same endpoint serves a Capacitor iOS shell later (`client=ios`, an App Link callback instead of a scheme).
- **Session storage.** Desktop: Better Auth's cookies in a persistent partition (`persist:phean`), which Chromium encrypts at rest with the OS keychain (macOS Keychain, Windows DPAPI, libsecret on Linux) when the `EnableCookieEncryption` fuse is on. No token in a plain file; the app stores only window bounds and preferences. Android: Chrome's own cookie store.
- **Sign-out and revocation.** Sign-out is the web's; the desktop also clears the partition's storage and stops polling. Signing out, or revoking a session from `/account`, deletes the session row, which cascades to that device's push subscriptions, and the next request from the device lands on sign-in. Leaving or being removed from a workspace stops its notifications at send time (membership check). The feed answers 401 for a dead session, and the desktop shows signed-out state in the tray.

## 4. Security checklist

Each item is marked ⬜ (to verify) and becomes ✅ only with evidence (a test, a config line, or a review).

### Electron
- ⬜ `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `nodeIntegrationInSubFrames: false`, `webviewTag: false`, `webSecurity: true` on every window; asserted by a unit test on the window options and by the Playwright smoke test reading `process` from the page (undefined).
- ⬜ A minimal typed preload (`contextBridge`): `signInWithBrowser(provider)`, `version`, `platform`. Every IPC handler checks `event.senderFrame.url` is the Phean origin; no generic `send`/`invoke` passthrough.
- ⬜ CSP: the bundled offline page has `default-src 'none'` plus its own style. The remote origin gains a baseline CSP from the web app (`object-src 'none'; base-uri 'self'; frame-ancestors 'none'`, `form-action` limited to self and the providers); a nonce-based `script-src` is a follow-up because Next's inline scripts need nonces wired through the layout.
- ⬜ Navigation allowlist: `will-navigate`, `will-redirect` and `will-frame-navigate` allow only the Phean origin (exact scheme, host, port); `setWindowOpenHandler` denies every new window and hands http(s) URLs to the external opener.
- ⬜ `shell.openExternal` only for `https:` (and `http:` on loopback in development) after `new URL()` parsing, credentials refused; agent links (rendered by `OutsideLink`, `rel="noopener noreferrer"`, `target="_blank"`) therefore always leave the app for the system browser and never load in a privileged window.
- ⬜ `setPermissionRequestHandler` and `setPermissionCheckHandler` deny everything except `clipboard-sanitized-write` (Copy buttons) for the Phean origin; notifications are shown by main, not the page.
- ⬜ Fuses at package time: `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on, `EnableCookieEncryption` on, `GrantFileProtocolExtraPrivileges` off; checked in CI with `npx @electron/fuses read`.
- ⬜ No `remote` module (removed from Electron long ago; `@electron/remote` never installed), no `file://` content (the offline page is served by a custom `app:` protocol with a fixed file map).
- ⬜ Deep links: only `phean://open/<path>` and `phean://auth/callback`; the path must pass `safeNextPath` and start with `/w/`, `/workspaces` or `/account`, and anything else is dropped.
- ⬜ Signed, verified updates: macOS builds signed and notarized (Squirrel.Mac refuses unsigned updates), Windows NSIS signed with `publisherName` checked by electron-updater, `latest*.yml` sha512 checked; updates only from the GitHub Releases of this repository over HTTPS.
- Tauri's equivalent (not chosen) would be minimal capabilities with a `remote.urls` scope of the one origin.

### Android (TWA)
- ⬜ No JavaScript bridge (TWA has none); no WebView in the app at all, so `allowFileAccess` and friends do not arise; the fallback when Chrome is missing is a Custom Tab, not a WebView (`fallbackType: customtabs`).
- ⬜ `android:usesCleartextTraffic="false"` and a network security config with `cleartextTrafficPermitted="false"`.
- ⬜ Verified App Links: `android:autoVerify="true"` intent filter for `https://<domain>/w/` only; `/.well-known/assetlinks.json` served by Phean from `PHEAN_ANDROID_CERT_SHA256` (fingerprints are public, not secrets), checked by a unit test.
- ⬜ Only the launcher activity is `exported="true"`; every other component is `exported="false"`.
- ⬜ Permissions: `INTERNET` and `POST_NOTIFICATIONS` only; no storage, camera, location.
- ⬜ `allowBackup="false"` (Chrome holds the session, but there is nothing to leak in a backup either way).

### Web app (affects every platform)
- ⬜ The service worker never caches responses of signed-in pages or API routes; it serves only the static `/offline` page and handles `push`/`notificationclick`. Unit-tested for its cache list.
- ⬜ `/api/push/answer`: session cookie plus `Origin` equal to the app origin, the request id must match the open request, and it runs `answerInput` (no new authorization path).
- ⬜ Push payloads carry the event only (no secrets, nothing beyond what the Decisions page shows), and are encrypted end to end by Web Push. Lock-screen visibility follows the OS's privacy setting.
- ⬜ Agent-supplied URLs are never fetched by the server or the shell; agent text in notifications is plain text (the Notifications API renders no HTML) and in the app goes through `OutsideLink`/`MarkdownView` as today.

### Release
- ⬜ Dependencies pinned exactly in `apps/desktop` (no ranges), a lockfile committed, `pnpm audit --prod` in CI, and Dependabot config for `apps/desktop` (npm), `apps/android` (gradle) and GitHub Actions, with Electron majors grouped.
- ⬜ Signing keys never in the repository: Apple Developer ID certificate and notarization API key, the Windows signing certificate (or Azure Trusted Signing), and the Android upload key live in GitHub Actions secrets of a `release` environment with required reviewers, or on the owner's machine. Play App Signing holds the Android app signing key.
- ⬜ Release builds only from tags on `main` in the protected `release` environment.

## 5. Repository layout and tooling

```
apps/
├── desktop/            # Electron shell: own package.json and pnpm-lock.yaml, TypeScript strict
│   ├── src/main/       # window, security, deep links, tray, shortcut, inbox poller, updater
│   ├── src/preload/    # the typed contextBridge API
│   ├── static/         # offline page, icons
│   ├── tests/          # vitest unit tests for the pure parts (URL checks, deep-link mapping, feed diffing)
│   └── e2e/            # Playwright `_electron` smoke test against a local Phean (next start)
└── android/            # TWA: a small Gradle project on android-browser-helper, twa-manifest.json
docs/apps/              # this plan, per-platform READMEs, local-task prompts
```

- **Not a root workspace member.** `apps/desktop` has its own lockfile and is installed with `pnpm --dir apps/desktop install`. The root `pnpm install` (Vercel's) therefore never downloads Electron, Vercel's build is untouched, and `pnpm check` at the root excludes `apps/` (tsconfig `exclude`, eslint `ignores`). `.vercelignore` drops `apps/` from uploads. Shared code is the client-safe `src/lib` (routes, `pathOf`, `safeNextPath`), imported by relative path and bundled into main with esbuild, so the desktop and the web never disagree on a path.
- **Desktop tooling:** TypeScript strict (the root's flags plus `noUncheckedIndexedAccess`), ESLint flat config, vitest for unit tests, Playwright `_electron` for the smoke test (launch, load a local Phean, sign in with the seeded demo account, open a deep link, check the window's security settings from the page, see a notification fired by the feed). `pnpm --dir apps/desktop check` mirrors the root's.
- **Android tooling:** Gradle with the Android Gradle Plugin, `./gradlew lint assembleDebug` in CI. An emulator smoke test (install, launch, the verified origin opens) runs in CI with `reactivecircus/android-emulator-runner` on a KVM-enabled Ubuntu runner, as a non-blocking job until it proves stable.
- **CI (`.github/workflows/apps.yml`, path-filtered to `apps/**`, `docs/apps/**` and the push code):** desktop `check` + Linux package + Playwright smoke under `xvfb-run` on Ubuntu; macOS and Windows unsigned packaging on their runners (no secrets on PRs); Android `lint assembleDebug`. The existing `ci.yml` keeps running `pnpm check` and `pnpm test:e2e` for the web app unchanged.
- **Versioning and channels:** the desktop app is versioned on its own (`apps/desktop/package.json`, starting `0.1.0`), tagged `desktop-v*`; prereleases (`-beta.N`) feed a beta channel through electron-updater's `channel`, releases feed stable. Android `versionCode` comes from the tag; Play internal testing first, then production.

## 6. Milestones

**M0, the plan.** This document, reviewed by three independent reviewers (security, platform architecture, fit with AGENTS.md), with the decisions recorded in §8. Acceptance: committed on a branch, draft PR open.

**M1, the desktop shell, signed in and usable, with deep links.**
- `apps/desktop` builds and runs on Linux in CI and on the owner's macOS/Windows machine unsigned.
- Opens the configured origin (`PHEAN_DESKTOP_ORIGIN`, defaulting to production), signs in with a password (two-factor included) and with GitHub or Google through the browser handoff, and stays signed in across restarts.
- `phean://open/w/<slug>/link/<id>` focuses the running app at that object; a second launch focuses the first.
- Tray with Open, Decisions, Quit; global shortcut opens Decisions; offline page and reconnect.
- Every Electron item in §4 verified, the smoke test green in CI, `pnpm check` and `pnpm test:e2e` still green at the root.

**M2, the Android app, signed in and usable, with App Links.**
- `apps/android` builds a debug APK in CI; the owner installs it on their phone (local task).
- Opens full screen without a URL bar (Digital Asset Links verified), sign-in and two-factor work, `https://<domain>/w/<slug>/link/<id>` from another app opens in Phean.
- Manifest and service worker shipped on the web (installable PWA, offline page), `pnpm test:e2e` covers the manifest and the offline page.

**M3, Decision notifications on both, with the server side.**
- An agent's `request_input` reaches the owner's Android phone as a notification within seconds, and the desktop within the poll interval; tapping an option button answers it, and the agent's `wait_for_answers` returns that answer; tapping the body opens the request.
- A stale notification (the question already answered or replaced) answers nothing and says so.
- Server: schema, services, routing, dispatch and adapters of §2 with their domain, isolation, policy and e2e tests; this part is purely additive and may merge first, by the owner.

**M4, auto-update and the release pipeline.**
- Tagging `desktop-v0.x.y` builds, signs and notarizes macOS, signs Windows, builds the Linux AppImage, and publishes a GitHub Release; an installed older build updates itself and restarts, and a tampered `latest.yml` is refused.
- Android release AAB signed with the upload key and uploaded to Play internal testing.
- Dependabot live; the release environment requires the owner's approval.

**Later, iOS.** Home-screen PWA with Web Push first (no new code). Then, if wanted, a Capacitor 8 shell: the `/native/authorize` handoff with an App Link callback, Universal Links from `apple-app-site-association`, APNs or Web Push behind the same push service.

## 7. What this cloud session cannot do

These are self-contained prompts for a local session on the owner's machine, in [`local-tasks/`](local-tasks/). None of them involves pasting a secret anywhere: secrets go straight from the owner's machine into Vercel, GitHub Actions secrets or the OS keychain.

| Task | Prompt |
| --- | --- |
| Run the desktop app on macOS/Windows and check it end to end | [`01-desktop-local-check.md`](local-tasks/01-desktop-local-check.md) |
| Android emulator with acceleration, and the real phone | [`02-android-device-check.md`](local-tasks/02-android-device-check.md) |
| VAPID keys and Android fingerprints into Vercel | [`03-vercel-push-and-app-links.md`](local-tasks/03-vercel-push-and-app-links.md) |
| Code signing and notarization secrets into GitHub | [`04-desktop-signing.md`](local-tasks/04-desktop-signing.md) |
| Android upload key and the Play listing | [`05-play-store.md`](local-tasks/05-play-store.md) |

FCM and APNs credentials are not needed for the chosen approach (Web Push uses VAPID); they come back only with a Capacitor shell.

## 8. Decisions and rejected options

Recorded as reviews land.

| Decision | Chosen | Rejected, and why |
| --- | --- | --- |
| Shell vs bundled client | Shell around the hosted origin | A bundled client: a second front end and an API, for an app whose value is the existing pages |
| Desktop | Electron 45 + electron-builder/updater | Tauri: WebKitGTK rendering gaps, no Playwright, Rust; Electron Forge: Squirrel updater has no Linux |
| Android | TWA | Capacitor: embedded-webview sign-in workaround, FCM credentials, bridge exposed to a remote origin; Tauri mobile: the same plus no first-party push |
| Push | Web Push with VAPID | FCM directly: a Firebase project and credentials for no gain while Android is a TWA |
| Desktop notifications | Poll a person-scoped feed | Web Push in Electron: Electron has no push service; a WebSocket per person: the web app is deliberately poll-based for people |
| Repo layout | `apps/*` with their own lockfiles | A root pnpm workspace: Vercel's install would pull Electron, and the root build would change |
