import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins/jwt";
import { organization } from "better-auth/plugins/organization";

import { WORKSPACE_SLUG_PATTERN } from "@/lib/domain";
import { routes } from "@/lib/routes";

import { appUrl, mcpResourceUrl, oauthProviders, oauthRegisterLimit, trustedOrigins } from "../config";
import { lazyDb, type Db } from "../db/client";
import * as authSchema from "../db/schema/auth";
import { oauthResource } from "../db/schema/auth";
import { resolveOAuthAgent } from "../domain/agents";
import { findTenantBySlug } from "../domain/tenants";

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

/** The `resource` values of an authorize request, which may repeat. */
function requestedResources(params: unknown): string[] {
  const value = (params as { resource?: unknown } | undefined)?.resource;
  return (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string");
}

/** Which of this provider's MCP endpoints a resource names. Mirrors `mcpResourceTarget` for a given base. */
function resourceTarget(baseUrl: string, resource: string): { slug: string | null } | null {
  if (resource === `${baseUrl}${routes.mcp()}`) return { slug: null };
  const prefix = `${baseUrl}${routes.mcp("")}`;
  const slug = resource.startsWith(prefix) ? resource.slice(prefix.length) : "";
  return WORKSPACE_SLUG.test(slug) ? { slug } : null;
}

const WORKSPACE_SLUG = new RegExp(`^${WORKSPACE_SLUG_PATTERN}$`);

/**
 * The provider only grants resources it has a row for. A workspace's URL gets one the first time a
 * client asks for it, and only if the workspace exists; anything else is left for it to refuse.
 */
async function registerWorkspaceResources(database: Db, baseUrl: string, resources: string[]): Promise<void> {
  for (const resource of resources) {
    const slug = resourceTarget(baseUrl, resource)?.slug;
    if (!slug || !(await findTenantBySlug(database, slug))) continue;
    await database
      .insert(oauthResource)
      .values({ id: randomUUID(), identifier: resource, name: `Phean MCP (${slug})`, createdAt: new Date(), updatedAt: new Date() })
      .onConflictDoNothing({ target: oauthResource.identifier });
  }
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
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/oauth2/authorize") {
          await registerWorkspaceResources(database, baseUrl, requestedResources(ctx.query ?? ctx.body));
          return;
        }
        if (ctx.path !== "/oauth2/register") return;
        // Open registration is for public clients: the provider would hand anyone who asks a client secret.
        // One that names no method is registered as public, which RFC 7591 3.2.1 allows and the response states.
        const body = (ctx.body ?? {}) as { token_endpoint_auth_method?: unknown };
        if (body.token_endpoint_auth_method === undefined) return { context: { body: { ...body, token_endpoint_auth_method: "none" } } };
        if (body.token_endpoint_auth_method !== "none") {
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
        resource: `${baseUrl}${routes.mcp()}`,
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
        // A workspace's URL is a resource of its own, and any client may ask for it; the dialog and this check keep it honest.
        enforcePerClientResources: false,
        customAccessTokenClaims: async ({ referenceId, resources }) => {
          const principal = referenceId ? await resolveOAuthAgent(database, referenceId) : null;
          if (!principal) throw new APIError("BAD_REQUEST", { error: "invalid_grant", error_description: "This agent no longer has access." });
          // Backstop for the dialog: a token for a workspace's URL only ever names an agent of that workspace.
          for (const resource of resources ?? []) {
            const target = resourceTarget(baseUrl, resource);
            if (!target || (target.slug !== null && target.slug !== principal.tenant.slug)) {
              throw new APIError("BAD_REQUEST", { error: "invalid_grant", error_description: "This agent works in another workspace than the address it was approved for." });
            }
          }
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

/**
 * Registration refuses client secrets, so don't advertise them. `private_key_jwt` stays: a CIMD client
 * authenticates with the keys its metadata document publishes.
 */
const TOKEN_ENDPOINT_AUTH_METHODS = ["none", "private_key_jwt"];

/** RFC 8414 metadata for `/.well-known/oauth-authorization-server/api/auth`, trimmed to what Phean accepts. */
export function authServerMetadataRoute(provider: Auth): (request: Request) => Promise<Response> {
  const metadata = oauthProviderAuthServerMetadata(provider);
  return async (request) => {
    const response = await metadata(request);
    const body = (await response.json()) as Record<string, unknown>;
    return new Response(JSON.stringify({ ...body, token_endpoint_auth_methods_supported: TOKEN_ENDPOINT_AUTH_METHODS }), { status: response.status, headers: response.headers });
  };
}

/**
 * `/api/auth/*`. The provider also answers the metadata under its own base path, before any hook
 * runs, so that one request goes through the same trimming as the RFC 8414 route.
 */
export function authRouteHandler(provider: Auth): (request: Request) => Promise<Response> {
  const metadata = authServerMetadataRoute(provider);
  return async (request) => {
    const { pathname } = new URL(request.url);
    const { baseURL } = await provider.$context;
    if (request.method === "GET" && pathname === `${new URL(baseURL).pathname}/.well-known/oauth-authorization-server`) return metadata(request);
    return provider.handler(request);
  };
}

/**
 * RFC 9728 metadata for a workspace's own MCP URL: the shared endpoint's, naming that URL as the
 * resource, which clients such as VS Code require to match the address they were given exactly.
 */
export function workspaceResourceMetadata(provider: Auth, getDatabase: () => Db): (request: Request, slug: string) => Promise<Response> {
  return async (_request, slug) => {
    if (!WORKSPACE_SLUG.test(slug) || !(await findTenantBySlug(getDatabase(), slug))) return new Response("Not found", { status: 404 });
    const shared = await provider.handler(new Request(`${appUrl()}/.well-known/oauth-protected-resource${routes.mcp()}`));
    if (!shared.ok) return shared;
    const body = (await shared.json()) as Record<string, unknown>;
    return new Response(JSON.stringify({ ...body, resource: mcpResourceUrl(slug) }), { status: 200, headers: shared.headers });
  };
}

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
