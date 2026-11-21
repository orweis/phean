# Phean for Android

A Trusted Web Activity (TWA): a small Android app that opens the hosted Phean in **Chrome itself**, full screen, once Digital Asset Links verify. Sign-in, two-factor, password managers and passkeys work exactly as on the web, because it *is* the web. There is no WebView and no JavaScript bridge. Notifications are the web app's Web Push, which Chrome delegates to this app so they show under Phean's name and icon. See `docs/apps/PLAN.md` §1 for why.

The project is a hand-kept Gradle project on [android-browser-helper](https://github.com/GoogleChrome/android-browser-helper), shaped like the one Bubblewrap 1.27.0 generates. Bubblewrap would add subclasses of the library's classes; this project names the library's `LauncherActivity` and `DelegationService` directly, since it overrides nothing.

| | |
| --- | --- |
| Package | `app.phean` |
| Opens | `https://<host>/workspaces` |
| App Links | `https://<host>/w/…` only, verified (`autoVerify`) |
| Host | `phean.host` in `gradle.properties` (default `phean-alpha.vercel.app`), or `-Pphean.host=…` |
| Version | `phean.version` (`0.1.0`); `versionCode = major × 10000 + minor × 100 + patch` (`100`) |
| SDK | `minSdk` 26, `compileSdk` and `targetSdk` 36 |
| Toolchain | Gradle 9.9.2 (wrapper, checksum-pinned), Android Gradle Plugin 9.5.2, JDK 17 or later |
| Library | `com.google.androidbrowserhelper:androidbrowserhelper:2.7.4` |

## Build

You need a JDK (17+) and the Android SDK with `platforms;android-36` and `build-tools;36.0.0`:

```sh
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
export ANDROID_HOME=/path/to/android-sdk

./gradlew lint assembleDebug checkManifest
./gradlew assembleRelease -Pphean.host=phean.example   # unsigned unless the signing variables below are set
./gradlew bundleRelease                                # the AAB for Play
```

`checkManifest` runs `scripts/check-manifest.mjs` (plain Node, no dependencies) on the source manifest and on the manifest merged with the libraries'. It can also be run on its own, from any directory:

```sh
node scripts/check-manifest.mjs                       # the source manifest, and twa-manifest.json against the build
node scripts/check-manifest.mjs app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml \
  --res app/src/main/res --host phean-alpha.vercel.app
node --test scripts/check-manifest.test.mjs           # the checker's own tests
```

## Install

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

A debug build is signed with Gradle's own debug key in `~/.android/debug.keystore`, never in this repository. It runs full screen only where `assetlinks.json` lists that key's fingerprint (a preview or local deployment, **never production**); elsewhere Chrome shows it with a URL bar, which is still enough to try it.

## App Links and Digital Asset Links

The link is verified in both directions:

- **The app trusts the site:** the `asset_statements` resource, built from `phean.host`.
- **The site trusts the app:** Phean serves `/.well-known/assetlinks.json` from two environment variables on its deployment:
  - `PHEAN_ANDROID_PACKAGE`, which defaults to `app.phean`;
  - `PHEAN_ANDROID_CERT_SHA256`, comma-separated SHA-256 fingerprints in `AA:BB:…` form.

  For production, set the fingerprints of **Play App Signing's key** and of **the upload key**; Play Console shows both under *Setup → App signing*. With no valid fingerprint the file is `[]`. Fingerprints are public values. Malformed ones are left out.

To check verification on a phone (local task 02):

```sh
curl -sI https://<host>/.well-known/assetlinks.json         # 200, application/json, no redirect
adb shell pm verify-app-links --re-verify app.phean
adb shell pm get-app-links app.phean                         # <host>: verified
adb shell am start -a android.intent.action.VIEW -d "https://<host>/w/<slug>/link/<id>"   # opens in Phean
```

## Signing

Release signing reads **environment variables only**. No keystore is in this repository, and `.gitignore` refuses `*.keystore`, `*.jks` and `*.p12`.

| Variable | |
| --- | --- |
| `PHEAN_ANDROID_KEYSTORE` | Path to the upload keystore, outside the repository (in CI, decoded from a secret into `$RUNNER_TEMP`) |
| `PHEAN_ANDROID_KEYSTORE_PASSWORD` | The keystore's password |
| `PHEAN_ANDROID_KEY_ALIAS` | The upload key's alias |
| `PHEAN_ANDROID_KEY_PASSWORD` | The key's password |

Without `PHEAN_ANDROID_KEYSTORE`, a release build is unsigned. The upload key lives in the protected `release` environment's secrets, or on the owner's machine. Play App Signing holds the app signing key (local task 05).

## Notifications

The `DelegationService` is exported, because Chrome binds to it to show Phean's Web Push notifications as the app's own. android-browser-helper serves only the verified browser that launched the app. Option buttons and the "Sent … / Undo" notification come from the service worker in the web app (`src/lib/push.ts`). On Android 13+, `NotificationPermissionRequestActivity` (not exported) asks for `POST_NOTIFICATIONS` when the page requests notification permission.

## What the libraries bring, and what is removed

The merged manifest is what ships, so `checkManifest` reads it too. These three things come from libraries and are removed with `tools:node="remove"`:

- **android-browser-helper's `ShortcutTrampolineActivity`** (exported) and `ColdShortcutActivity`. Phean has no launcher shortcuts.
- **androidx.profileinstaller's `ProfileInstallReceiver`** (exported, DUMP-protected). It is for adb and benchmarks. Profiles still install through the library's initializer, which is not exported.
- **androidx.core's `app.phean.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`**. It exists for `ContextCompat.registerReceiver(…, RECEIVER_NOT_EXPORTED)` below Android 13, and nothing in the resolved dependencies calls that. Re-check this when a dependency changes: `checkManifest` fails if the permission comes back.

## Bubblewrap

`twa-manifest.json` describes this app in Bubblewrap's format, for its tools such as `bubblewrap fingerprint`. `checkManifest` keeps it in step with `gradle.properties` and `colors.xml`. Do not run `bubblewrap update`: it would regenerate the project from its template. That would bring back `allowBackup="true"`, an exported service resource, and the library components removed above.

## Security checklist (PLAN.md §4, "Android")

| Item | Evidence |
| --- | --- |
| No WebView or JavaScript bridge; the fallback is Custom Tabs | `FALLBACK_STRATEGY` is `customtabs`, and no `WebViewFallbackActivity` is declared. There is no app code at all, only the library's classes. `checkManifest` fails otherwise |
| `usesCleartextTraffic="false"` and a network security config with `cleartextTrafficPermitted="false"` | `AndroidManifest.xml`, `res/xml/network_security_config.xml`; checked by `checkManifest` |
| Verified App Links for `https://<host>/w/` only; `assetlinks.json` as JSON, with no redirect and outside the sign-in proxy | The `autoVerify` intent filter has `pathPrefix="/w/"` and `https` only (checked). The web side is `src/app/.well-known/assetlinks.json/route.ts` with `tests/asset-links.test.ts` and `e2e/pwa.spec.ts` |
| Exported: only `LauncherActivity` and `DelegationService` | `checkManifest` on the source and merged manifests; `NotificationPermissionRequestActivity`, `FocusActivity` and `FileProvider` are `exported="false"` |
| Permissions: `INTERNET` and `POST_NOTIFICATIONS` only | `checkManifest`, on the merged manifest too |
| `allowBackup="false"` | Set, with `fullBackupContent="false"` and data extraction rules that exclude everything (Android 12+ device transfer); checked |
| No committed keystore that production trusts | Signing comes from environment variables only, and `.gitignore` refuses keystores. A debug key is never listed in production's `PHEAN_ANDROID_CERT_SHA256` (local task 03) |
| Back at the first page leaves the app | android-browser-helper's default; checked on the phone (local task 02) |
