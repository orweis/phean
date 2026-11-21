import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

const BASELINE = ["base-uri 'self'", "frame-ancestors 'none'", "worker-src 'self'"];

async function rules() {
  return Object.fromEntries(
    (await nextConfig.headers!()).map(({ source, headers }) => [source, Object.fromEntries(headers.map(({ key, value }) => [key.toLowerCase(), value]))]),
  );
}

describe("the baseline Content Security Policy (PLAN.md §4)", () => {
  it("covers the app's pages, with no plugins outside workspaces, and never form-action", async () => {
    const all = await rules();
    for (const source of ["/workspaces/:path*", "/account/:path*", "/invite/:path*", "/sign-in/:path*", "/sign-up/:path*", "/offline", "/native/:path*", "/oauth/:path*"]) {
      const policy = all[source]?.["content-security-policy"];
      for (const directive of [...BASELINE, "object-src 'none'"]) expect(policy, source).toContain(directive);
    }
    for (const [source, headers] of Object.entries(all)) expect(headers["content-security-policy"] ?? "", source).not.toContain("form-action");
  });

  it("lets workspace pages show a same-origin PDF, and leaves a document's bytes to their own policy", async () => {
    const all = await rules();
    const workspace = Object.keys(all).filter((source) => source.startsWith("/w/"));
    expect(workspace).toEqual(["/w/:slug", "/w/:slug/:rest((?!documents/[^/]+/file$).*)"]);
    for (const source of workspace) {
      for (const directive of [...BASELINE, "object-src 'self'"]) expect(all[source]!["content-security-policy"]).toContain(directive);
    }
  });

  it("leaves the marketing site, the docs and the blog alone", async () => {
    const sources = Object.keys(await rules());
    expect(sources.filter((source) => /^\/(docs|blog|privacy)?(\/|$|:)/.test(source))).toEqual([]);
  });

  it("serves the service worker uncached, for the whole origin", async () => {
    const worker = (await rules())["/sw.js"]!;
    expect(worker["cache-control"]).toBe("no-cache");
    expect(worker["service-worker-allowed"]).toBe("/");
  });
});
