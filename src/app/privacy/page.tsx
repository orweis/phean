import type { Metadata } from "next";

import { LEGAL_PAGES, ReadingPage } from "@/components/site/reading-page";

export const metadata: Metadata = LEGAL_PAGES.privacy;

/** The privacy policy, from `content/legal/privacy.md`. */
export default function PrivacyPage() {
  return <ReadingPage page="privacy" />;
}
