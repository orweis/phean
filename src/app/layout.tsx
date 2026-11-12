import type { Metadata, Viewport } from "next";

import { COLOR_SCHEMES, colorSchemeFor, themeColorFor } from "@/lib/appearance";
import { getAppearance } from "@/server/web";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Phean", template: "%s | Phean" },
  description: "Agents do the tasks. You make the calls. Phean is the decision center for a fleet of AI agents.",
};

/** One theme-color per device scheme, so the browser chrome still follows the device under System. */
export async function generateViewport(): Promise<Viewport> {
  const appearance = await getAppearance();
  return {
    colorScheme: colorSchemeFor(appearance),
    themeColor: COLOR_SCHEMES.map((scheme) => ({ media: `(prefers-color-scheme: ${scheme})`, color: themeColorFor(appearance, scheme) })),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-appearance={await getAppearance()}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
