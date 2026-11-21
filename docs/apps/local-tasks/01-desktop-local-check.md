# Local task 01: run the Phean desktop app on this computer and check it end to end

You are working in a checkout of `orweis/phean`. Check out the branch `claude/native-apps` and pull. Read `AGENTS.md`, `docs/apps/PLAN.md` and `apps/desktop/README.md` first.

Goal: confirm the Electron shell in `apps/desktop` works on this machine's OS (macOS or Windows; Linux is covered by CI), against a local Phean and then against production. Do not commit unless a fix is needed; if one is, commit it on `claude/native-apps` with `pnpm --dir apps/desktop check` passing and push.

Steps:

1. Start a local Phean: `pnpm install`, `pnpm db:seed`, then `pnpm build && pnpm start` (port 3000). Seeded sign-in: `demo@phean.dev` / `phean-demo-password`.
2. `pnpm --dir apps/desktop install`, then `PHEAN_DESKTOP_ORIGIN=http://localhost:3000 pnpm --dir apps/desktop dev`.
3. Check, and note pass/fail for each:
   - The window opens Phean; sign in with the demo account; quit and relaunch: still signed in.
   - Turn on two-factor in `/account` for the demo account, sign out, sign in: the code is asked for. Turn it off again afterwards.
   - The tray (or menu bar) icon shows; its menu has Open, Decisions, Quit; closing the window keeps the app in the tray.
   - The global shortcut (see the README) brings up the Decisions page from another app.
   - From a terminal, open a deep link: macOS `open "phean://open/w/acme/decisions"`, Windows `start phean://open/w/acme/decisions`. (Deep links need the packaged app on macOS: run `pnpm --dir apps/desktop package` and launch the built app from `apps/desktop/dist`.) The running app focuses that page; a second launch does not open a second app.
   - Click an outside link inside a task (an agent's link): it opens in your default browser, not in the app.
   - Stop the local server: the app shows its offline page; start the server again: the app comes back by itself.
   - With the demo agent tokens the seed printed, run `pnpm demo:agents http://localhost:3000 <token1> <token2>` or ask a question with an MCP client; a desktop notification appears within about 25 seconds (on macOS only with a signed build, see local task 04); clicking an option answers it; clicking the body opens the decision.
   - Switch the OS between light and dark with Phean's appearance on System: the app follows.
4. If GitHub or Google sign-in is configured locally (`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` in `.env.local`; never paste them anywhere), check "Continue with GitHub in your browser": the browser opens, you sign in, confirm, and the app is signed in.
5. Repeat the sign-in and notification checks with `PHEAN_DESKTOP_ORIGIN` unset (production).

Report: OS and version, each check with pass/fail and what you saw, and any console errors from the app's DevTools (View menu in development builds).
