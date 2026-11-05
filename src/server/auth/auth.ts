import { AsyncLocalStorage } from "node:async_hooks";

import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins/jwt";
import { organization } from "better-auth/plugins/organization";

import { appUrl, oauthProviders, oauthRegisterLimit, trustedOrigins } from "../config";
import { lazyDb, type Db } from "../db/client";
import * as authSchema from "../db/schema/auth";
import { resolveOAuthAgent } from "../domain/agents";

const SEVEN_DAYS_IN_SECONDS = 60 * 60 * 24 * 7;
const ONE_HOUR_IN_SECONDS = 60 * 60;
/** Longer than the longest lifetime a person can grant: the agents row decides when access ends, not this. */
const REFRESH_TOKEN_SECONDS = 366 * 24 * 60 * 60;
/**
 * A client that retries a refresh gets the same answer for this long. At 0, replaying a rotated token
 * ends the whole client-and-user family, which on a shared CIMD client takes other agents with it.
 * The stored answer skips the claims check, so the row check at /mcp is what stops a revoked agent.
 */
const REFRESH_REUSE_SECONDS = 30;

function socialProviders() {
  const { github, google } = oauthProviders();
  return {
    ...(github ? { github } : {}),
    ...(google ? { google } : {}),
  };
}

/** The agent the dialog's action just approved, for the consent call it wraps. Nothing else sets it. */
const approvedAgent = new AsyncLocalStorage<string>();

export const withApprovedAgent = <T>(agentId: string, run: () => Promise<T>): Promise<T> => approvedAgent.run(agentId, run);

export function createAuth(database: Db, baseUrl: string) {
  return betterAuth({
    appName: "Phean",
    baseURL: baseUrl,
    trustedOrigins: [...new Set([baseUrl, ...trustedOrigins()])],
    database: drizzleAdapter(database, { provider: "pg", schema: authSchema }),
    emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
    socialProviders: socialProviders(),
    // Serverless instances do not share memory, so limits are counted in Postgres.
    rateLimit: { storage: "database" },
    // Consent happens only through the dialog's action, and auth.api still reaches these. /token would hand out session JWTs.
    disabledPaths: ["/oauth2/consent", "/oauth2/create-client", "/token"],
    hooks: {
      // Open registration is for public clients: the provider would hand anyone who asks a client secret.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/oauth2/register" && (ctx.body as { token_endpoint_auth_method?: unknown } | undefined)?.token_endpoint_auth_method !== "none") {
          throw new APIError("BAD_REQUEST", { error: "invalid_client_metadata", error_description: 'Phean registers public clients only. Register with token_endpoint_auth_method "none".' });
        }
      }),
    },
    plugins: [
      // Organizations are Phean tenants ("workspaces"). Invitations are shared as links,
      // so no email delivery is configured.
      organization({ creatorRole: "owner", invitationExpiresIn: SEVEN_DAYS_IN_SECONDS }),
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        loginPage: "/sign-in",
        consentPage: "/oauth/approve",
        resource: `${baseUrl}/mcp`,
        scopes: ["phean:read", "phean:write", "phean:admin", "offline_access"],
        grantTypes: ["authorization_code", "refresh_token"],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        // The default, "web", refuses a loopback redirect from a client that omits application_type.
        clientRegistrationDefaultApplicationType: "infer",
        accessTokenExpiresIn: ONE_HOUR_IN_SECONDS,
        refreshTokenExpiresIn: REFRESH_TOKEN_SECONDS,
        refreshTokenReuseInterval: REFRESH_REUSE_SECONDS,
        // A DPoP-bound token carries a `cnf` that Phean's bearer check can't honour, so refuse the proof up front.
        dpop: { signingAlgorithms: [] },
        rateLimit: { register: { window: 60, max: oauthRegisterLimit() } },
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
      // Must be last: lets server actions set auth cookies.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];

let instance: Auth | undefined;

function getAuth(): Auth {
  instance ??= createAuth(lazyDb, appUrl());
  return instance;
}

/**
 * The deployment's auth instance, built on first use: the provider seeds its resource row when
 * constructed, and `next build` evaluates this module in several workers with no database to open.
 */
export const auth: Auth = new Proxy({} as Auth, {
  get: (_target, property) => Reflect.get(getAuth(), property) as unknown,
  has: (_target, property) => Reflect.has(getAuth(), property),
});

export interface ConsentDecision {
  /** The agent `approveAgent` made or renewed, or null when the person declined. */
  agentId: string | null;
  /** The signed query the provider sent to the dialog. */
  oauthQuery: string;
  /** Narrows what the token's `scope` says. The agents row, not this, decides what the agent may do. */
  scope?: string;
}

/**
 * Tells the provider what the person chose in the dialog, as that person. Returns where to send the
 * browser: the client's callback, with a code or with `error=access_denied`. Approve the agent first,
 * so the code is bound to a row that already exists.
 */
export async function completeConsent(provider: Auth, requestHeaders: Headers, { agentId, oauthQuery, scope }: ConsentDecision): Promise<{ url: string }> {
  const headers = new Headers(requestHeaders);
  // Without this the provider throws its redirect rather than returning it.
  headers.set("accept", "application/json");
  const { baseURL } = await provider.$context;
  const consent = () =>
    provider.api.oauth2Consent({
      body: { accept: agentId !== null, oauth_query: oauthQuery, ...(scope !== undefined && { scope }) },
      headers,
      request: new Request(`${baseURL}/oauth2/consent`, { method: "POST", headers }),
      asResponse: false,
    });
  return agentId === null ? consent() : withApprovedAgent(agentId, consent);
}
