# OAuth for MCP: spike notes

Task 1 of [the plan](2026-11-05-mcp-oauth.md). The spike code is deleted; these notes are what Tasks 4 and 5 use.

**Verdict: the library can do this cleanly, by a different route than the plan expected.** The one Phean dialog is Better Auth's `consentPage`, not its `postLogin` page. A server action creates the agent, then calls the consent endpoint with the agent id in an `AsyncLocalStorage` that `consentReferenceId` reads.

Versions: `better-auth`, `auth`, `@better-auth/mcp`, `@better-auth/cimd` and `@better-auth/oauth-provider` all 1.7.17.

How things were checked:

- **Vitest:** the real provider on PGlite, with real `agents` rows from `createAgent`.
- **Live:** `next build` and `next start` (production mode) on `http://localhost:3201`, with an `@modelcontextprotocol/client` 2.4.0 client and Chromium: 401, discovery, DCR, sign-in, dialog, Allow, token, `whoami`, refresh.
- **Source:** marked "read only" where nothing was run.
- **Not run:** a real Vercel deployment, or any client other than the SDK.

## Answers to the plan's table

| Question | Expected | Found |
| --- | --- | --- |
| Can a `postLogin` page collect our fields, then `consentReferenceId` return the agent id? | Yes | Possible, but the wrong route. `/oauth2/continue` still redirected to the consent page, and `consentReferenceId` receives only `{ user, session, scopes }`, so the choice has nowhere to live except shared session state, where two tabs race. Use `consentPage` with `AsyncLocalStorage`. |
| Can the consent screen be auto-accepted, so people see one dialog? | Yes | Not needed: the consent page is the dialog. `skipConsent` is not available to these clients anyway: DCR rejects `skip_consent` (400), and `create-client` accepted the field but the client still reached the dialog. |
| Is `referenceId` on refresh tokens, and given to `customAccessTokenClaims` on refresh? | Yes | Yes. The row stores it and the claims function gets it, with `user`, `scopes` and `resources`. |
| Can throwing in `customAccessTokenClaims` stop a refresh? | Yes | Yes, and it runs before rotation, so a refused refresh burns nothing. Throw `APIError("BAD_REQUEST", { error: "invalid_grant", … })`, which gives a 400. A plain `Error` gives a 500. It also stops the first code exchange, leaving no refresh row. |
| How do `/.well-known/*` routes mount, including RFC 8414 at `/api/auth`? | Route handlers | Route handlers under `src/app/.well-known/`, served by `next start`, and the SDK accepted the issuer. See "Task 4". |
| Does `resource` accept `http://localhost:3200/mcp` and Vercel preview origins? | Unknown | Yes. HTTPS anywhere; HTTP only on loopback. `createAuth(db, "http://phean.test")` **throws**. See "Keeping the audience exact". |
| Is `@better-auth/cimd` working with `metadataProfile: "mcp-2026-07-28"`? | Yes | Yes in Vitest with a stubbed fetch: authorize, dialog, token. Missing `client_name` and a metadata-address `client_id` are refused. The real Node transport refused a hostname resolving to loopback. No real CIMD client has been run. |
| What does local JWT verification look like without `requireMcpAuth`? | JWKS verify | `verifyJwsAccessToken` from `better-auth/oauth2` with `jwksFetch: () => auth.api.getJwks()`. No HTTP call and no direct `jose` dependency. |

## Keeping the audience exact

`mcpResourceUrl()` is `${appUrl()}/mcp`, and it is the single source for the plugin's `resource`, the verifier's `audience`, and the challenge. `iss` is `${appUrl()}/api/auth`.

| Environment | `appUrl()` | Audience | Checked |
| --- | --- | --- | --- |
| Dev | `http://localhost:${PORT ?? 3000}` | `http://localhost:3000/mcp` | Plugin accepts the form (`http://localhost`, `127.0.0.1`, `[::1]`) |
| E2E | `BETTER_AUTH_URL` = `http://localhost:3200` | `http://localhost:3200/mcp` | Full flow in Vitest; same shape live on 3201 |
| Vercel preview | `https://$VERCEL_URL` | `https://phean-abc.vercel.app/mcp` | Plugin accepts the form; **not run on Vercel** |
| Production | `https://$VERCEL_PROJECT_PRODUCTION_URL` | That domain plus `/mcp` | **Not run on Vercel** |

Rules that keep it exact:

- Pass `resourceUrl: appUrl()` to `withMcpAuth`. Without it the challenge is built from `X-Forwarded-Host`. With it, a spoofed `X-Forwarded-Host: evil.example` still named the real URL.
- A request for any other `resource` gets `invalid_target`. A DCR client registered at one URL gets `invalid_target` at another, even on a shared database, because each deployment seeds its own resource row. A CIMD client is not stopped this way: it passed that check and went on to sign-in.
- Connecting through a different host than `appUrl()`, such as a preview's branch alias or `127.0.0.1` in dev, publishes a `resource` the client did not ask for, and the SDK's resource check should reject it (read only). People connect at the canonical URL. A branch alias needs `BETTER_AUTH_URL` set for it. Previews also sit behind Vercel Authentication, so OAuth there needs the bypass.
- A self-hosted deployment on plain HTTP off loopback now fails on first use of `auth`, sign-in included. Say so in `docs/DEPLOYMENT.md`.
- Tests can't use `TEST_ORIGIN` (`http://phean.test`) as the auth base. Use `http://localhost:3200`.
- Omitting `resource` from the **authorize** request yields an opaque, non-JWT token with no claims, which `/mcp` refuses, so the person would approve for nothing. The dialog must refuse first. Omitting it only from the token request is fine: the token keeps the audience from authorize, on refresh too.

## The server-side consent call

This replaces posting to `/oauth2/consent`. All three of these are needed, and each was found by failing without it:

- `request`: without it, `UNAUTHORIZED: request not found`.
- `asResponse: false`: passing `request` otherwise returns a `Response`.
- `accept: application/json` on the headers: without it the redirect is thrown rather than returned.

```ts
const headers = new Headers(await nextHeaders());
headers.set("accept", "application/json");
const { url } = await withApprovedAgent(agent.id, () =>
  auth.api.oauth2Consent({
    body: { accept: true, oauth_query: oauthQuery, scope },
    headers,
    request: new Request(`${appUrl()}/api/auth/oauth2/consent`, { method: "POST", headers }),
    asResponse: false,
  }),
);
redirect(url);
```

Cancel is the same call with `accept: false`, which returns `error=access_denied` with `iss`. `next/navigation`'s `redirect()` worked for a loopback callback, and for `cursor://…`: the browser attempted that navigation and the dialog stayed on screen. So show "you can close this window" rather than leave a live Allow button.

## Recommended shapes

### Task 4: `src/server/auth/auth.ts`

```ts
const approvedAgent = new AsyncLocalStorage<string>();
export const withApprovedAgent = <T>(agentId: string, run: () => Promise<T>) => approvedAgent.run(agentId, run);

export function createAuth(database: Db, baseUrl: string) {
  return betterAuth({
    // …today's options…
    // Consent only through the dialog's action; auth.api still reaches these. /token would hand out session JWTs.
    disabledPaths: ["/oauth2/consent", "/oauth2/create-client", "/token"],
    plugins: [
      organization(…),
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        loginPage: "/sign-in",
        consentPage: "/oauth/approve",
        resource: `${baseUrl}/mcp`,
        scopes: ["phean:read", "phean:write", "phean:admin", "offline_access"],
        grantTypes: ["authorization_code", "refresh_token"],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: "infer",
        accessTokenExpiresIn: 3600,
        refreshTokenExpiresIn: 366 * 24 * 3600, // the agents row decides when access ends
        refreshTokenReuseInterval: 30, // see "Decisions"
        dpop: { signingAlgorithms: [] },
        postLogin: {
          page: "/oauth/approve",
          shouldRedirect: () => false,
          consentReferenceId: () => approvedAgent.getStore(),
        },
        customAccessTokenClaims: async ({ referenceId }) => {
          const principal = referenceId ? await resolveOAuthAgent(database, referenceId) : null;
          if (!principal) throw new APIError("BAD_REQUEST", { error: "invalid_grant", error_description: "This agent no longer has access." });
          return { agent_id: principal.agent.id };
        },
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
      nextCookies(),
    ],
  });
}
```

**`auth` must become lazy.** The provider seeds its resource row as soon as it is constructed, so `export const auth = createAuth(lazyDb, appUrl())` opened the database at import, in many build workers at once (seen with an unreachable `DATABASE_URL`). That breaks the rule against opening the database at import. All of this was tested, and the build then logged no database errors:

- Export a `Proxy` over `getAuth()`, with `get` and `has` traps. `toNextJsHandler(auth)` and `oauthProviderAuthServerMetadata(auth)` both work with it.
- `getSession` must await `headers()` before touching `auth.api`. Today's one-liner reads `auth.api` first, which constructs it during prerendering.
- The `auth` CLI can't read a `Proxy`. Add `src/server/auth/auth.config.ts` exporting a plain `auth`, and point `auth:schema` at it.

**Verifier**, in `oauth.ts`:

```ts
const payload = await verifyJwsAccessToken(token, {
  jwksFetch: () => auth.api.getJwks(),
  verifyOptions: { issuer: `${appUrl()}/api/auth`, audience: mcpResourceUrl(), typ: "at+jwt" },
}).catch(() => null);
if (!payload || payload.cnf || typeof payload.agent_id !== "string") return null;
return { agentId: payload.agent_id };
```

It refused a wrong audience, a wrong issuer, a key that isn't ours, and a session JWT from `/api/auth/token`. It reads the JWKS on every request (one query), since the function form loaded twice for two verifications.

**Routes:**

- `src/app/.well-known/oauth-authorization-server/api/auth/route.ts`: `export const GET = oauthProviderAuthServerMetadata(auth);`
- `src/app/.well-known/oauth-protected-resource/mcp/route.ts`: `export const GET = (request: Request) => auth.handler(request);`
- The same handler at `src/app/.well-known/oauth-protected-resource/route.ts`, the spec's fallback. The plugin answered there through `auth.handler`; the route was not mounted in the live run.
- Metadata responses carry no CORS headers (read only). The token endpoint doesn't appear to either, so browser-based clients are out of scope for now.

**Handler:** `withMcpAuth(handler, verifyToken, { required: true, resourceMetadataPath: "/.well-known/oauth-protected-resource/mcp", resourceUrl: appUrl() })`. The live 401 was correct, and a token in the query string got a 401.

**Revoker:** `delete from oauth_refresh_token where reference_id = agentId` in the service's transaction. The next refresh got `invalid_grant`.

**Migration:** `auth generate` then `db:generate` produced only new tables and foreign keys (`jwks`, `oauth_client`, `oauth_resource`, `oauth_client_resource`, `oauth_refresh_token`, `oauth_access_token`, `oauth_consent`, `oauth_client_assertion`), so it stays compatible with the previous release.

### Task 5: `/oauth/approve`

Page:

1. `verifyOAuthQueryParams(query, (await auth.$context).secret)`. A tampered query returned false.
2. Refuse unless `params.get("resource") === mcpResourceUrl()`.
3. Take the name from `auth.api.getOAuthClientPublic({ query: { client_id }, headers })`. It works for DCR and CIMD. Its `redirect_uris` is empty, so take the host from the signed `redirect_uri`, which authorize has already matched.

Action, on Allow, in this order: resolve the workspace against memberships, call `approveAgent`, then make the consent call above inside `withApprovedAgent`. The agent exists before the client redeems its code, so a client that never does leaves an agent with no token until its expiry.

**Sign-in return is new work** in `src/app/(auth)/auth-page.tsx`. Authorize redirects to `/sign-in?<signed query>`, with no `next`. When `sig` is present, set `next` to `/api/auth/oauth2/authorize?<the query without sig, exp, ba_iat, ba_pl, ba_param>`, and drop `prompt=login`, which would otherwise loop. Authorize revalidates everything, so nothing here is trusted. Verified in the browser: sign-in returned to the dialog. Social sign-in takes the same `next` but was not run.

**Session ended, or the signed query expired.** The action sends the person to `routes.signIn(currentApproveUrl)`, as the plan has it. The signed query lasts 10 minutes (`codeExpiresIn`) and then the consent call fails with `invalid_signature` (read only, not run). So the same re-run of authorize is the way back, and it keeps Review Focus 3 true.

## What changed from the plan

| Where | Plan said | Now |
| --- | --- | --- |
| Tasks 4, 5 | `postLogin` page plus auto-accept | `consentPage` with `withApprovedAgent` |
| Task 4 | `auth = createAuth(lazyDb, appUrl())` unchanged for callers | Callers unchanged, but it is a lazy `Proxy`, plus `auth.config.ts`, a `session.ts` edit and a script change |
| Task 4 | Route CIMD fetches through `assertWebhookUrlSafe` | Use `fetchClientMetadataResource` from `@better-auth/cimd/node`. It resolves once, requires every answer to be public, pins the address, and refuses redirects, which a check before `fetch` can't do. It is still Node only. |
| Task 4 | Rate limit `/oauth2/register` | Built in: 5 a minute, and hit live (429) under `next start`. Authorize is 30 and token 20 (read only). Limits are per client address and on only in production mode, as I understand Better Auth's defaults (not tested in dev). |
| Task 4 | `resource` and `verifyOAuthToken` | As above, with `resourceUrl` on `withMcpAuth`. Fake-origin tests must use a loopback base. |
| Task 4 | Not mentioned | Add `disabledPaths`. Without it, a signed-in browser could POST `/oauth2/consent` with no agent, get a code, and leave a consent row that makes later authorizes **skip the dialog**. The claims backstop refuses the token, so this never yields access, but it would break that client. |
| Task 4 | Not mentioned | `clientRegistrationDefaultApplicationType: "infer"`. The default `web` refuses loopback redirects from clients that omit `application_type`. |
| Task 4 | Not mentioned | `refreshTokenExpiresIn`. At the default 30 days, an agent on a 90-day or 1-year grant loses access after 30 idle days. |
| Task 4 | Not mentioned | `dpop: { signingAlgorithms: [] }`. By default a client sending a DPoP proof gets a bound token (`cnf`), which Phean's bearer check can't honour. With an empty list that request gets `invalid_dpop_proof`. The metadata then shows an empty list; whether real clients accept that is for Task 9. |
| Task 5 | Files listed | Add `src/app/(auth)/auth-page.tsx`. |
| Tasks 5, 9 | `oauthClient` registers per test | The register limit applies under `next start`, so e2e needs a shared client or a raised `rateLimit.register`. |

Confirmed as the plan assumed:

- Each authorize shows the dialog again. `prompt=none` returns `consent_required`.
- PKCE is required, and a wrong verifier fails and burns the code.
- Redirect URIs match exactly, except that a loopback port may differ.
- Signing out doesn't stop refresh.
- The dialog sets the level: consent can narrow scope (down to `offline_access` alone, with the audience intact) but not raise it past what was requested.

## Decisions for Or or the coordinator

1. **Refresh reuse interval.** The spec calls 0 "the Better Auth recommendation", but `mcp()` defaults to 30 seconds for MCP clients. It matters more than expected: replaying a rotated token at 0 invalidates the whole family, and the family is **client plus user, not agent**. In the test, replaying agent A's old token also killed agent B's refresh token, with both on one client id, which is normal for CIMD. Two parallel refreshes gave 200 and 400 at both settings, so 30 does not remove that race; at 0 the winner's token kept working (not checked at 30). At 30, a retried replay returns the stored response without running the claims, so the per-request row check is what cuts off a revoked agent. **I recommend 30.** Ruled: 30, and the sketch above now says so.
2. **Token `scope` versus the chosen level.** The SDK requested everything in `scopes_supported`, so with no narrowing, a Write approval carried `phean:admin` in its token. Pass `scope` to the consent call, as the requested scopes at or below the chosen level, keeping `offline_access`. A client that asked only for `phean:read` can't be given a `phean:write` scope, since consent refuses raising. Either cap the dialog at what was requested, or let the row decide and treat `scope` as a hint. **I recommend the row decides**, as the spec already says it is the source of truth.

## Refresh tokens depend on the client

A refresh token is issued only if the client's grants include `refresh_token` and it requested `offline_access`. The SDK adds `offline_access` when the server advertises it and the client's `grant_types` include `refresh_token` (my test client declared them). A client omitting `grant_types` registers with `authorization_code` only, and gets no refresh token, so it would meet the dialog every hour. Check real clients in Task 9. I found no option that forces one.

## Spec check (2026-07-28)

Read the authorization page, plus its security considerations, discovery, client registration and security best practices pages. Requirements the plan misses or only half covers:

- **Dialog, MUST (already planned):** "clearly display the redirect URI hostname during authorization". Task 5 has it.
- **Dialog, SHOULD (not planned):** "display additional warnings for `localhost`-only redirect URIs". A CIMD client's name proves nothing about which local process receives the code. Add a line to the dialog.
- **Clickjacking (not planned):** nothing in `next.config.ts` or `proxy.ts` stops the dialog being framed. The best-practices page requires `frame-ancestors` or `X-Frame-Options: DENY` for proxy servers' consent pages, and the same attack applies to Allow here. Add a header for `/oauth/:path*`.
- **Runtime 403, SHOULD:** insufficient permissions get a 403 with `error="insufficient_scope"`. Task 6 refuses a Read agent's mutating call as a tool error. The tools are hidden and the spec says there is no step-up, so this looks acceptable, but it is a deliberate deviation.
- **`scope` in `WWW-Authenticate`, SHOULD:** not sent, so clients fall back to all of `scopes_supported`, and the dialog narrows. The spec allows this for general-purpose clients.

Handled by the library or planned, and seen working: PRM and AS metadata with matching `issuer`, `iss` on success and error responses, S256 PKCE, refresh rotation for public clients, exact redirect matching, audience check, 401 for invalid tokens, `offline_access` left out of PRM.

I didn't read OAuth 2.1 Section 7 itself, which the security page incorporates. That reading remains open.

## Not answered here

- Whether `mcp-handler` 2.3.0 works with clients on the 2026-07-28 revision. Answered in Task 9 below: it does, by hand.
- Claude Code, Cursor and VS Code, and whether a second workspace collides in their token stores. Answered from their code in Task 9 below; not yet run with a person signing in.

## Real clients (Task 9)

No client was signed in here: connecting one needs a person to approve in a browser and would change the owner's own client configuration. These findings come from the installed clients' code and from public sources, plus Vitest and Playwright runs of the same flows with the SDK client. **A check with real clients against a real deployment is still needed**; the script below is for that.

| | Claude Code 2.1.301 | Cursor 3.28.7 (VS Code 1.128 base) | VS Code (source on `main`; not installed here) |
| --- | --- | --- | --- |
| Registration | CIMD when the server advertises `client_id_metadata_document_supported` (Phean does): `client_id` `https://claude.ai/oauth/claude-code-client-metadata`. Falls back to DCR if its redirect isn't the document's loopback `/callback` | DCR only: its provider defines no `clientMetadataUrl` | CIMD when advertised: `client_id` `https://vscode.dev/oauth/client-metadata.json`; DCR otherwise, then a prompt for a client id |
| `token_endpoint_auth_method` | `none` (document and DCR body) | `none` | `none` (document) |
| `grant_types` | `authorization_code`, `refresh_token` | `authorization_code`, `refresh_token` | `authorization_code`, `refresh_token`, `urn:ietf:params:oauth:grant-type:device_code` |
| Redirects | `http://localhost/callback`, `http://127.0.0.1/callback` (any port) | `cursor://…` and a loopback when gated on | `http://127.0.0.1:33418/`, `https://vscode.dev/redirect`; `application_type: native` |
| `offline_access` | Appended when `scopes_supported` has it (`y4s`): yes for Phean | Not read in the bundle; the SDK 1.x `auth()` it ships adds it when advertised and `refresh_token` is a grant | Appended when `scopes_supported` has it (`extHostAuthentication.ts`, "adding `offline_access` when the server advertises it") |
| DPoP | None in the MCP path (the binary's DPoP code belongs to AWS SDK and `openid-client`) | None found | None in `oauth.ts` or the dynamic provider |
| Token store key | `mcpOAuth["<name>\|<sha256(type,url,headers)[0:16]>"]` (`md()`): name **and** URL | `storageScope`: `canonicalServerUrl` by default, keyed `[url:<server url>] tokens`; `serverIdentifier` (per name) only when shared-process routing is on, and even then a new name with no tokens copies the URL-keyed ones (`getSecretWithFallback`) | One auth provider per authorization server **plus** PRM `resource` (`this.id = server + ' ' + resource`); sessions in it are matched by scopes only |
| Second workspace on the same `/mcp` | Separate (different name) | **Collides**: the second name reads or overwrites the first's tokens | **Collides**: same provider, same scopes, same person, so the second server finds the first session |

So two of three clients would put a second workspace on the first one's login. **Built `/mcp/w/[slug]`** per the spec:

- `/mcp/w/<slug>` is its own OAuth resource: tokens requested for it carry it as `aud`. VS Code requires PRM `resource` to equal the URL it was given exactly (`fetchResourceMetadata` in `src/vs/base/common/oauth.ts`), so a shared audience would not have worked there; a distinct resource also gives VS Code a distinct provider.
- `/.well-known/oauth-protected-resource/mcp/w/<slug>` serves the shared PRM with that `resource`, and 404 for a workspace that doesn't exist.
- The provider grants only resources it has a row for. A before-hook on `/oauth2/authorize` adds the `oauth_resource` row for an existing workspace's URL. `enforcePerClientResources: false`, since a DCR client is linked only to `/mcp` at registration and a CIMD client's row may not exist yet. What keeps it honest: the dialog accepts only this deployment's addresses and offers only the URL's workspace (refusing the post of another); `customAccessTokenClaims` refuses a token for `/mcp/w/<slug>` to an agent of any other workspace, on exchange and on refresh; and `/mcp/w/<slug>` refuses any credential, key or token, whose agent works elsewhere. The slug never chooses the tenant.
- The Agents page now shows the workspace's URL in every snippet. `/mcp` keeps working for everything already connected.

Tests: `tests/oauth.test.ts` "a workspace's own URL" (metadata, challenge, dialog workspace, full flow with `aud`, refresh, a shared token refused there, "a token for another workspace is refused there", a key only at its own URL, the claims backstop, unknown workspace), `tests/isolation.test.ts`, `tests/config.test.ts`, and two Playwright steps in `e2e/oauth.spec.ts` with the SDK client on `/mcp/w/…`.

Smaller findings:

- Phean advertises `dpop_signing_alg_values_supported: []`. None of the three sends DPoP, so none is affected.
- `token_endpoint_auth_methods_supported` is now `["none", "private_key_jwt"]`, at the RFC 8414 route and at `/api/auth/.well-known/oauth-authorization-server`, which the provider answers in its `onRequest`, before any hook, so the catch-all route trims it (`authRouteHandler`). A DCR request with no `token_endpoint_auth_method` is registered as `none` and told so; an explicit `client_secret_*` is still refused.
- The spike's worry that a client omitting `grant_types` gets no refresh token doesn't apply to these three: all send `refresh_token` and get `offline_access` added.
- Claude Code's CIMD document lists `http://localhost/callback` with no port. Loopback ports may differ (confirmed in the spike), so its real port matches. Not run.
- VS Code's document also lists `https://vscode.dev/redirect`, a web relay. The dialog will show `vscode.dev` with no loopback warning when VS Code uses it.
- Both CIMD clients share one `client_id` across every user and workspace, so the "family is client plus user" note in Decisions applies to them: a replay at reuse 0 would end every Phean agent the person runs in that client. Reuse 30 holds (below).

### Concurrent refresh (step 3)

Run in Vitest with the SDK 2.4.0 client and the real provider: a client holds an expired access token and a live refresh token, then makes 2 or 5 calls at once, each on its own transport, as a client running parallel tool calls does.

| Reuse | Parallel calls | Calls that succeeded | The client's refresh token afterwards |
| --- | --- | --- | --- |
| 30 s (shipped) | 2 | 1 | works (200) |
| 30 s | 5 | 1 | works |
| 0 | 2 | 1 | **dead** (400): logged out at the next expiry |
| 0 | 5 | 1 | **dead**: the losers ended the family (`session not found`) |

At 0, the losing replays end the family, including the winner's new token, so the client must sign in and be approved again within the hour. That is the "logs a client out" case, so 30 stays (as already ruled). At 30 the losing calls still fail once with `invalid_grant`: the winner marks the old token rotated before it stores the replayable answer, and a request arriving between the two gets neither. The client is not logged out. Real clients mostly avoid the race: Claude Code takes a file lock per server before refreshing (`mcp-refresh-<key>.lock` in `refreshAuthorization`), and Cursor a disk lock (`mcp_oauth_refresh_prepare`, `holdsDiskLock`). Run on PGlite in one process, not Postgres.

### The 2026-07-28 transport (step 4)

By hand, with that revision's headers (`MCP-Protocol-Version: 2026-07-28`, `Mcp-Method`, `Mcp-Name`) and `_meta` (`io.modelcontextprotocol/protocolVersion`, `clientCapabilities`, `clientInfo`), on a `phn_` key through `createPheanMcpHandler`:

- `server/discover` → 200, `supportedVersions: ["2026-07-28"]`, capabilities and instructions.
- `tools/list` with no `initialize` → 200, `resultType: "complete"`, `ttlMs: 0`, `cacheScope: "private"`, `serverInfo` in `_meta`.
- `tools/call` `whoami` → 200, `resultType: "complete"`.
- A missing or mismatched `Mcp-Method`, or a mismatched `Mcp-Name` → 400, `-32020` (HeaderMismatch).
- `initialize` sent as 2026-07-28 → `-32601`; the 2025-era `initialize` still works (every existing test uses it).

So `mcp-handler` 2.3.0 with `@modelcontextprotocol/server` 2.4.0 serves both revisions. Nothing migrated. Not run with a real client on that revision.

### Manual test script for Or

Against a real deployment (`https://<domain>`), with two workspaces you own, `acme` and `globex`.

1. **Claude Code:** `claude mcp add --transport http phean-acme https://<domain>/mcp/w/acme`, then `/mcp` in a session and authenticate. The dialog should offer only Acme. Allow with Write, 7 days. Ask it to call `whoami`: agent and workspace Acme.
2. Same for `phean-globex` at `/mcp/w/globex`. Then call `whoami` on **both** servers again: each names its own workspace.
3. **Cursor:** add both to `~/.cursor/mcp.json` with their `/mcp/w/…` URLs, sign in to each from Settings → MCP, check `whoami` on both. Optional, to see the collision: add a third entry for `https://<domain>/mcp` under another name after one is signed in, and note whether it connects without a dialog.
4. **VS Code:** add both to `.vscode/mcp.json` (`"type": "http"`), start each, sign in, check `whoami`. Note whether the dialog says `127.0.0.1` (loopback warning shown) or `vscode.dev`.
5. On the Agents pages: each agent shows OAuth, its level and its end date. Revoke the Acme agent: its next call fails, and Globex's keeps working.
6. Refresh after an hour: leave a client idle for more than an hour, then call a tool. It should work without a dialog. In Claude Code, ask for several tool calls at once after the hour; a single failure there is the race above, a dialog is a bug.
7. Record each client's version and anything that differed.

Sources: the installed Claude Code binary (`~/.local/share/claude/versions/2.1.301`: `clientMetadata`, `clientMetadataUrl`, `y4s`, `md`); `https://claude.ai/oauth/claude-code-client-metadata`; Cursor's `extensions/cursor-mcp/dist/main.js` (`clientMetadata`, `storageScope`, `sharedTokensKey`, `getSecretWithFallback`, `ti`); `https://vscode.dev/oauth/client-metadata.json`; VS Code `src/vs/workbench/api/common/extHostAuthentication.ts` and `src/vs/base/common/oauth.ts` on `microsoft/vscode` `main`; [den.dev, "CIMD in VS Code"](https://den.dev/blog/cimd-vs-code-mcp/); [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog).
