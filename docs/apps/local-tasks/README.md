# Local tasks

Work this cloud session cannot do: it needs the owner's machine, a real device, hardware acceleration, or credentials that must never pass through a chat or the repository. Each file is a self-contained prompt. Open a Claude Code session on your machine in a checkout of `orweis/phean` (on the branch named in the prompt) and paste the file's contents.

Rules every prompt carries:

- Never paste a token, key, password or certificate into a chat, a prompt, a commit or an issue. Secrets go straight from your machine into Vercel (`vercel env add`), GitHub (`gh secret set`, reading from a file or stdin) or your OS keychain.
- Report back with what passed, what failed, and the exact commands run, not the secrets.

| # | Task | Needs | When |
| --- | --- | --- | --- |
| 01 | [Desktop app on macOS/Windows](01-desktop-local-check.md) | Your computer | After M1 lands on the branch |
| 02 | [Android emulator and your phone](02-android-device-check.md) | Android Studio, your phone | After M2 lands |
| 03 | [VAPID keys and Android fingerprints into Vercel](03-vercel-push-and-app-links.md) | Vercel CLI login | Before testing M3 on production |
| 04 | [Desktop code signing and notarization](04-desktop-signing.md) | Apple Developer account, a Windows signing option | M4 |
| 05 | [Android upload key and Play listing](05-play-store.md) | Google Play Console | M4 |
