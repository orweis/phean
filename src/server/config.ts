/** Public base URL of this deployment, used for auth callbacks and links handed to agents. */
export function appUrl(): string {
  const explicit = process.env.BETTER_AUTH_URL ?? process.env.PHEAN_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

/** The MCP endpoint's address: the audience of its OAuth tokens and the resource they are requested for. */
export function mcpResourceUrl(): string {
  return `${appUrl()}/mcp`;
}

/** Better Auth's own limit on open client registration, per client address a minute. */
const OAUTH_REGISTER_LIMIT = 5;

/** The UI tests register many clients from one address; a deployment leaves this unset. */
export function oauthRegisterLimit(): number {
  const raised = Number(process.env.PHEAN_OAUTH_REGISTER_LIMIT);
  return Number.isInteger(raised) && raised > 0 ? raised : OAUTH_REGISTER_LIMIT;
}

/** Every origin a browser may legitimately use to reach this deployment. */
export function trustedOrigins(): string[] {
  const hosts = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ].filter((host): host is string => Boolean(host));
  return [appUrl(), ...hosts.map((host) => `https://${host}`)];
}

/** Emails with read-only access to every workspace (the operator view of status per customer). */
export function platformAdminEmails(): Set<string> {
  return new Set(
    (process.env.PHEAN_PLATFORM_ADMINS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export function oauthProviders(): { github?: OAuthCredentials; google?: OAuthCredentials } {
  const pick = (id?: string, secret?: string) =>
    id && secret ? { clientId: id, clientSecret: secret } : undefined;
  return {
    github: pick(process.env.GITHUB_CLIENT_ID, process.env.GITHUB_CLIENT_SECRET),
    google: pick(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET),
  };
}

/**
 * Where document bytes live. A Vercel Blob store (private access) when its read-write token is set,
 * the database otherwise: local development, tests, and a deployment without a store connected.
 */
export function blobStoreConfig(): { driver: "vercel-blob"; token: string } | { driver: "database" } {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (process.env.PHEAN_BLOB_DRIVER !== "database" && token) return { driver: "vercel-blob", token };
  return { driver: "database" };
}
