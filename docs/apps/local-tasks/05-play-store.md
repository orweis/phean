# Local task 05: the Android upload key and the Play listing

You are working in a checkout of `orweis/phean`. Read `AGENTS.md`, `docs/apps/PLAN.md` and `apps/android/README.md` first.

Goal: an upload key held only by the owner and GitHub Actions, Play App Signing for the app key, and the app on Play internal testing. Never paste a keystore, password or service-account JSON into a chat or the repository.

Steps:

1. Create the app in the Google Play Console (package name from `apps/android/twa-manifest.json`), enrol in Play App Signing (Google holds the app signing key).
2. Make an upload keystore outside the repository: `keytool -genkeypair -v -keystore ~/phean-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000`. Keep it, and its password, in a password manager.
3. Store it for CI in the `release` environment: `base64 -i ~/phean-upload.jks | gh secret set ANDROID_UPLOAD_KEYSTORE_BASE64 --env release`, then `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEY_PASSWORD` typed at `gh secret set` prompts.
4. For uploads from CI, create a Play Console service account with release permissions for this app only, and store its JSON with `gh secret set PLAY_SERVICE_ACCOUNT_JSON --env release < key.json`; then delete the local file.
5. Add both fingerprints (Play App Signing and upload key) to `PHEAN_ANDROID_CERT_SHA256` on Vercel (local task 03).
6. Store listing: name "Phean", the short description from `PRODUCT.md`, the icon and screenshots from the app (phone screenshots of Decisions and the board), the privacy policy URL `https://<domain>/privacy`, data safety (account data: email, name; no data sold; data encrypted in transit), content rating questionnaire.
7. Run the release workflow for Android (or `./gradlew bundleRelease` locally with the keystore from step 2) and upload to internal testing; install it on the phone from the testing link and run local task 02's checks.

Report: the package name, the testing track link (not secret), which secrets were created (names only), and the result of the checks.
