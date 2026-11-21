# Local task 02: the Phean Android app in an accelerated emulator and on a real phone

You are working in a checkout of `orweis/phean`. Check out `claude/native-apps` and pull. Read `AGENTS.md`, `docs/apps/PLAN.md` and `apps/android/README.md` first.

Goal: confirm the Trusted Web Activity in `apps/android` installs, opens Phean full screen, signs in, follows App Links and shows Decision notifications, first on an emulator, then on the owner's phone. Never paste a key or a password into a chat or a file in the repository.

Steps:

1. Install Android Studio (or the command-line tools) with an SDK for API 35 and a Google Play system image (it ships Chrome). Create an emulator with hardware acceleration (Hypervisor Framework on macOS, WHPX/AEHD on Windows, KVM on Linux).
2. Build: `cd apps/android && ./gradlew assembleDebug`. Install: `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
3. The debug build's signing certificate differs from the release one, so App Links verify only once its fingerprint is in Phean's `assetlinks.json`. Get it with `./gradlew signingReport` (SHA-256 of the debug variant). It is public, not a secret. For a local Phean, set `PHEAN_ANDROID_CERT_SHA256=<fingerprint>` in `.env.local`; for production, see local task 03.
4. Check on the emulator, pass/fail each:
   - Launch: Phean opens full screen with no URL bar (if a URL bar shows, Digital Asset Links did not verify: `adb shell pm get-app-links app.phean.android` shows the state).
   - Sign in with a password; with GitHub; with Google; with two-factor on. Each ends signed in.
   - `adb shell am start -a android.intent.action.VIEW -d "https://<domain>/w/<slug>/decisions"` opens in the app.
   - On the Decisions page, turn on notifications for this device, allow the permission prompt. Ask a question from an agent (an MCP client connected to the workspace, `request_input` with two options). A notification appears; tapping an option answers it (the agent's `wait_for_answers` returns it); tapping the body opens the decision.
   - Airplane mode: the offline page shows; back online: it recovers.
   - Back button from a task returns to the previous page, and from the first page leaves the app.
5. Repeat on the phone over USB (`adb devices`), with the debug build, then with a release build from Play internal testing once local task 05 is done.

Report: device or image, Android and Chrome versions, each check with pass/fail and what you saw, and `adb logcat` lines around any failure.
