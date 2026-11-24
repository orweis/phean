import type { MetadataRoute } from "next";

import { appUrl } from "@/server/config";

// Read per request, so the addresses are the deployment's own rather than the build machine's.
export const dynamic = "force-dynamic";

/** Where the app lives behind a sign-in, or answers machines only: nothing there is worth indexing. */
export const PRIVATE_PATHS = ["/w/", "/workspaces", "/account", "/admin", "/api/", "/oauth/", "/mcp", "/invite/", "/native/", "/offline", "/sign-in", "/sign-up"];

/**
 * The public site (landing page, docs, blog, privacy) is open to search engines and to the answer
 * engines' crawlers by name, so Phean can be found and cited; the app itself is not.
 */
export default function robots(): MetadataRoute.Robots {
  const base = appUrl();
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      {
        userAgent: ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended"],
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
