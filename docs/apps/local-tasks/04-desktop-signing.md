# Local task 04: code signing and notarization for the desktop app

You are working in a checkout of `orweis/phean`. Read `AGENTS.md`, `docs/apps/PLAN.md` (sections 4 and 6, M4) and `apps/desktop/README.md` first.

Goal: put the desktop signing credentials into GitHub Actions secrets of a protected `release` environment, so the release workflow signs macOS and Windows builds and electron-updater verifies them. Never paste a certificate, password or API key into a chat, a file in the repository, or a commit.

Steps:

1. In GitHub, create the environment `release` on `orweis/phean` with required reviewers (the owner) and a deployment branch rule for tags `desktop-v*`.
2. macOS (needs an Apple Developer Program membership):
   - Create a "Developer ID Application" certificate in Keychain Access or the developer portal, export it with its private key as a `.p12` with a strong password, to a path outside the repository.
   - Create an App Store Connect API key (Users and Access, Integrations, Keys) with the Developer role; download the `.p8` once.
   - Store them with `gh secret set --env release`, reading files from stdin so nothing is echoed: `base64 -i cert.p12 | gh secret set MAC_CERT_P12_BASE64 --env release`, `gh secret set MAC_CERT_PASSWORD --env release` (typed at the prompt), `base64 -i AuthKey.p8 | gh secret set APPLE_API_KEY_BASE64 --env release`, and `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID` the same way.
   - Delete the exported files once stored, or keep them only in the keychain or a password manager.
3. Windows: prefer Azure Trusted Signing (no hardware token). Create the account and certificate profile, a service principal with the signer role, and store `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_CERT_PROFILE` in the `release` environment. Note the certificate's publisher name for `publisherName` in `apps/desktop/electron-builder.yml`, and commit that one change (it is public) on `claude/native-apps` with `pnpm --dir apps/desktop check` passing.
4. Dry run: push a tag `desktop-v0.1.0-beta.1` from the branch (or run the release workflow by hand) and approve the environment. Check: the macOS DMG opens without a Gatekeeper warning (`spctl -a -vv` on the app says "Notarized Developer ID"), the Windows installer shows the publisher, and the GitHub Release has `latest.yml`, `latest-mac.yml` and `latest-linux.yml`.
5. Update check: install the beta, publish `desktop-v0.1.0-beta.2`, and confirm the installed app offers and installs the update.

Report: which secrets were created (names only), and each check's result.
