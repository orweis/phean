import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { cookies } from "next/headers";

import { Analytics } from "@/components/analytics";
import { ServiceWorker } from "@/components/service-worker";
import { CONSENT_COOKIE, parseConsent } from "@/lib/analytics";
import { COLOR_SCHEMES, colorSchemeFor } from "@/lib/appearance";
import { themeColorFor } from "@/lib/themes";
import { analyticsConfig, ANALYTICS_TEST_COOKIE } from "@/server/analytics";
import { hasSessionCookie } from "@/server/auth/session";
import { appUrl } from "@/server/config";
import { getAppearance, getTheme } from "@/server/web";

import "./globals.css";

/**
 * The display face (page titles, the site's headlines), self-hosted from the npm package and
 * preloaded, with a metric-matched fallback so a large headline does not shift as it arrives.
 */
const display = localFont({
  src: "../../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2",
  weight: "200 800",
  display: "swap",
  variable: "--font-bricolage",
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { default: "Phean", template: "%s | Phean" },
  description: "Agents do the tasks. You make the calls. Phean is the decision center for a fleet of AI agents.",
  applicationName: "Phean",
  openGraph: { siteName: "Phean", type: "website" },
};

/** One theme-color per device scheme, in the theme's paper, so the browser chrome still follows the device under System. */
export async function generateViewport(): Promise<Viewport> {
  const [appearance, theme] = await Promise.all([getAppearance(), getTheme()]);
  return {
    colorScheme: colorSchemeFor(appearance),
    themeColor: COLOR_SCHEMES.map((scheme) => ({ media: `(prefers-color-scheme: ${scheme})`, color: themeColorFor(theme, appearance, scheme) })),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [appearance, theme, jar, signedIn] = await Promise.all([getAppearance(), getTheme(), cookies(), hasSessionCookie()]);
  // Read from the environment and cookies only: the public site renders under this layout and never reads the database.
  const analytics = analyticsConfig(jar.get(ANALYTICS_TEST_COOKIE)?.value);
  return (
    <html lang="en" data-appearance={appearance} data-theme={theme} className={display.variable}>
      <body className="min-h-dvh">
        {children}
        <ServiceWorker />
        {analytics && <Analytics {...analytics} consent={parseConsent(jar.get(CONSENT_COOKIE)?.value)} signedIn={signedIn} />}
      </body>
    </html>
  );
}
