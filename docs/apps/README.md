# Native apps

The desktop and Android apps live in their own repository, [orweis/phean-apps](https://github.com/orweis/phean-apps). Their plan, its decisions, the security checklist and the local-task prompts are there too ([docs/PLAN.md](https://github.com/orweis/phean-apps/blob/main/docs/PLAN.md)).

This repository keeps what the server serves to them:

- the desktop's browser sign-in handoff (`src/server/auth/native.ts`, `/native/authorize`);
- push devices, routing and dispatch, the inbox feed, and answering from a notification;
- the web app manifest, the service worker, `/offline`, and `/.well-known/assetlinks.json`.

[CONTRACTS.md](CONTRACTS.md) is the source of truth for what the apps and the server exchange. phean-apps keeps an identical copy, and its CI fails when the two differ. Change this copy first, and only additively, because installed apps are older than the server.
