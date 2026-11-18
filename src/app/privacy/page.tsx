import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Metadata } from "next";

import { MarkdownView } from "@/components/documents/markdown-view";
import { Logo } from "@/components/logo";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How Phean collects, uses and protects information about the people and agents who use it.",
};

/** The privacy policy: one reading column under the site's bar, from `content/legal/privacy.md`. */
export default async function PrivacyPage() {
  const source = await readFile(path.join(process.cwd(), "content", "legal", "privacy.md"), "utf8");
  return (
    <div className="min-h-dvh">
      <header className="glass-bar text-ink">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4 sm:px-6">
          <Logo className="shrink-0" />
          <a href={routes.docs()} className="ml-auto text-sm font-semibold text-ink-2 hover:text-ink">
            Docs
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
        <article className="max-w-[72ch]">
          <header className="border-b border-rule pb-6">
            <h1 className="text-[1.75rem] leading-[2.15rem] font-bold tracking-title text-ink">Privacy policy</h1>
            <p className="mt-2 text-md text-ink-2">How Phean collects, uses and protects information about the people and agents who use it.</p>
          </header>
          <div className="docs-body mt-6">
            <MarkdownView source={source} headings="anchored" />
          </div>
        </article>
      </main>
    </div>
  );
}
