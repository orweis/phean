import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Phean", template: "%s | Phean" },
  description: "Humans set the goals. Agents roll the boulder. A shared task and goal ledger for teams of AI agents.",
};

/** The browser chrome takes the paper of each appearance (sRGB of `--color-paper`). */
export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0d17" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
