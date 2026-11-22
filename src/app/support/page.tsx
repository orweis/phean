import type { Metadata } from "next";

import { LEGAL_PAGES, ReadingPage } from "@/components/site/reading-page";

export const metadata: Metadata = LEGAL_PAGES.support;

/** The support page, from `content/legal/support.md`. */
export default function SupportPage() {
  return <ReadingPage page="support" />;
}
