# Local task 03: set the Web Push keys and the Android fingerprints on Vercel

You are working in a checkout of `orweis/phean`. Read `AGENTS.md`, `docs/apps/PLAN.md` (sections 2 and 4) and `docs/DEPLOYMENT.md` first.

Goal: give the Phean Vercel project the environment variables that push notifications and Android App Links need. Secrets go straight from this machine into Vercel; never print a private key in the chat, never write it to a file inside the repository, never commit it.

Steps:

1. `vercel login` and `vercel link` to the Phean project if this checkout is not linked yet.
2. Generate a VAPID key pair outside the repository: `cd "$(mktemp -d)" && npx --yes web-push@4.0.0 generate-vapid-keys --json > vapid.json`. Do not open or print the file in the chat.
3. Add them for Production and Preview, reading from the file so the private key never appears on screen:
   - `jq -r .publicKey vapid.json | vercel env add PHEAN_VAPID_PUBLIC_KEY production` (and again with `preview`)
   - `jq -r .privateKey vapid.json | vercel env add PHEAN_VAPID_PRIVATE_KEY production --sensitive` (and `preview`)
   - `vercel env add PHEAN_VAPID_SUBJECT production` with a `mailto:` contact address the owner chooses (and `preview`).
   Then delete the temporary directory (`rm -rf` it). Rotating the pair later invalidates every device's subscription, so keep it only in Vercel.
4. Android App Links: add `PHEAN_ANDROID_CERT_SHA256` (Production) with the SHA-256 fingerprints, comma-separated, of the Play App Signing certificate (Play Console, Setup, App signing) and of the upload key. These are public values. For previews, add the debug fingerprint from `./gradlew signingReport` in `apps/android`.
5. Redeploy production (`vercel deploy --prod` from `main`, or wait for the next merge) and check:
   - `curl https://<domain>/.well-known/assetlinks.json` lists the fingerprints.
   - Google's checker: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://<domain>&relation=delegate_permission/common.handle_all_urls` returns the statement.
   - Signed in on the web, the Decisions page offers "Notify me on this device".

Report: which variables were added in which environments (names only), and the two check results.
