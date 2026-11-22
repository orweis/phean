import { readFile } from "node:fs/promises";
import path from "node:path";

import { MarkdownView } from "@/components/documents/markdown-view";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

/** The site's pages in `content/legal`: the privacy policy, the terms and support. */
export const LEGAL_PAGES = {
  privacy: { title: "Privacy policy", description: "How Phean collects, uses and protects information about the people and agents who use it." },
  terms: { title: "Terms of service", description: "The terms for using Phean at phean.ai: your account, your workspaces, the agents you connect, and ours." },
  support: { title: "Support", description: "How to get help with Phean, report a problem or a security issue, and reach the people who run it." },
} as const;

export type LegalPageKey = keyof typeof LEGAL_PAGES;

/** One reading column under the site's bar, from `content/legal/<key>.md`. */
export async function ReadingPage({ page }: { page: LegalPageKey }) {
  const { title, description } = LEGAL_PAGES[page];
  const source = await readFile(path.join(process.cwd(), "content", "legal", `${page}.md`), "utf8");
  return (
    <div className="min-h-dvh">
      <SiteHeader current="legal" />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
        <article className="max-w-[72ch]">
          <header className="border-b border-rule pb-6">
            <h1 className="text-[1.75rem] leading-[2.15rem] font-bold tracking-title text-ink">{title}</h1>
            <p className="mt-2 text-md text-ink-2">{description}</p>
          </header>
          <div className="docs-body mt-6">
            <MarkdownView source={source} headings="anchored" />
          </div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
