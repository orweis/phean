import type { Metadata } from "next";

import { LEGAL_PAGES, ReadingPage } from "@/components/site/reading-page";

export const metadata: Metadata = LEGAL_PAGES.terms;

/** The terms of service, from `content/legal/terms.md`. */
export default function TermsPage() {
  return <ReadingPage page="terms" />;
}
