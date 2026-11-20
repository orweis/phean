import { Menu } from "lucide-react";

import { DocsNav, type DocsNavSection } from "@/components/docs-nav";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { DOC_SECTIONS, loadDocIndex } from "@/server/docs";

/** The docs site: a glass bar, the sections down the left, and the page in a reading column. */
export default async function DocsLayout({ children }: LayoutProps<"/docs">) {
  const pages = await loadDocIndex();
  const titles = new Map(pages.map((page) => [page.slug, page.slug === "index" ? "Overview" : page.title]));
  const sections: DocsNavSection[] = DOC_SECTIONS.map((section) => ({
    title: section.title,
    pages: section.slugs.map((slug) => ({ slug, title: titles.get(slug) ?? slug })),
  }));

  return (
    <div className="min-h-dvh">
      <SiteHeader current="docs" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <details className="group mt-4 rounded-lg border border-rule bg-panel lg:hidden">
          <summary className="flex h-11 items-center gap-2 px-4 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <Menu aria-hidden className="size-4 text-muted" />
            All docs pages
          </summary>
          <div className="border-t border-rule px-1 py-4">
            <DocsNav sections={sections} />
          </div>
        </details>
        <aside className="hidden lg:block">
          <div className="sticky top-16 max-h-[calc(100dvh-4rem)] overflow-y-auto py-8">
            <DocsNav sections={sections} />
          </div>
        </aside>
        <div className="min-w-0 py-8 lg:py-10">{children}</div>
      </div>
      <SiteFooter />
    </div>
  );
}
