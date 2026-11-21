import { androidAppLinks } from "@/server/config";

/** Read on every request, so a new fingerprint in the environment takes effect without a rebuild. */
export const dynamic = "force-dynamic";

/**
 * Digital Asset Links for the Android app (orweis/phean-apps, android/): the statement that lets it open
 * `https://<domain>/w/…` links (App Links) and show Phean full screen as a Trusted Web Activity.
 * Android fetches it without cookies and follows no redirect, so it sits outside the sign-in proxy.
 */
export function GET() {
  const app = androidAppLinks();
  const statements = app
    ? [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: { namespace: "android_app", package_name: app.packageName, sha256_cert_fingerprints: app.fingerprints },
        },
      ]
    : [];
  return Response.json(statements, { headers: { "Cache-Control": "public, max-age=300" } });
}
