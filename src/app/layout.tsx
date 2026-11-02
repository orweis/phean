import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Phean", template: "%s | Phean" },
  description: "Humans set the goals. Agents roll the boulder. A shared task and goal ledger for teams of AI agents.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
