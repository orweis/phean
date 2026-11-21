import { WORKSPACE_SLUG_PATTERN } from "@/lib/domain";
import { routes } from "@/lib/routes";

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

/**
 * An MCP endpoint's address: the audience of its OAuth tokens and the resource they are requested for.
 * With a slug, the workspace's own URL, which clients that keep one login per URL need for a second
 * workspace. Either way the agent's row, not the address, decides the workspace; the address must agree.
 */
export function mcpResourceUrl(slug?: string): string {
  return `${appUrl()}${routes.mcp(slug)}`;
}

const WORKSPACE_SLUG = new RegExp(`^${WORKSPACE_SLUG_PATTERN}$`);

/** Which of this deployment's MCP endpoints a resource names: the shared one (`slug: null`), a workspace's, or none. */
export function mcpResourceTarget(resource: string): { slug: string | null } | null {
  if (resource === mcpResourceUrl()) return { slug: null };
  const prefix = mcpResourceUrl("");
  if (!resource.startsWith(prefix)) return null;
  const slug = resource.slice(prefix.length);
  return WORKSPACE_SLUG.test(slug) ? { slug } : null;
}

/** Better Auth's own limit on open client registration, per client address a minute. */
const OAUTH_REGISTER_LIMIT = 5;

/** The UI tests register many clients from one address; a deployment leaves this unset. */
export function oauthRegisterLimit(): number {
  const raised = Number(process.env.PHEAN_OAUTH_REGISTER_LIMIT);
  return Number.isInteger(raised) && raised > 0 ? raised : OAUTH_REGISTER_LIMIT;
}

/**
 * Better Auth's own limit on authorize, per client address a minute, made explicit: each request may
 * fetch and store a CIMD client before anyone signs in.
 */
const OAUTH_AUTHORIZE_LIMIT = 30;

/** The UI tests authorize many clients from one address; a deployment leaves this unset. */
export function oauthAuthorizeLimit(): number {
  const raised = Number(process.env.PHEAN_OAUTH_AUTHORIZE_LIMIT);
  return Number.isInteger(raised) && raised > 0 ? raised : OAUTH_AUTHORIZE_LIMIT;
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

/**
 * How Phean sends email (the morning digest), through Resend's HTTP API: on when both the key and
 * the From address are set, off otherwise, and then the digest is read in the app only.
 */
export function emailConfig(): { apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PHEAN_EMAIL_FROM;
  return apiKey && from ? { apiKey, from } : null;
}

/** The Android app's package when `PHEAN_ANDROID_PACKAGE` is unset (apps/android). */
export const DEFAULT_ANDROID_PACKAGE = "app.phean";

/** An Android application id: dot-separated segments, each a letter then letters, digits or underscores. */
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** A SHA-256 certificate fingerprint as Play Console and keytool print it: 32 hex bytes, colon-separated. */
const CERT_SHA256 = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

/**
 * Which Android app may open this deployment's links and show its pages full screen: the package
 * (`PHEAN_ANDROID_PACKAGE`) and the SHA-256 fingerprints of the keys it is signed with
 * (`PHEAN_ANDROID_CERT_SHA256`, comma-separated: Play App Signing's and the upload key's). Both are
 * public values. A malformed fingerprint or package is refused and left out, never trusted
 * half-read; with no valid fingerprint there is no app to trust.
 */
export function androidAppLinks(): { packageName: string; fingerprints: string[] } | null {
  const packageName = process.env.PHEAN_ANDROID_PACKAGE?.trim() || DEFAULT_ANDROID_PACKAGE;
  const listed = (process.env.PHEAN_ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((fingerprint) => fingerprint.trim().toUpperCase())
    .filter(Boolean);
  const fingerprints = [...new Set(listed.filter((fingerprint) => CERT_SHA256.test(fingerprint)))];
  if (fingerprints.length < new Set(listed).size) console.warn("PHEAN_ANDROID_CERT_SHA256 has a malformed fingerprint; it is left out of assetlinks.json");
  if (!ANDROID_PACKAGE.test(packageName)) {
    console.warn("PHEAN_ANDROID_PACKAGE is not an Android package name; assetlinks.json trusts no app");
    return null;
  }
  return fingerprints.length ? { packageName, fingerprints } : null;
}
