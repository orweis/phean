import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";

import { MarkdownView } from "@/components/documents/markdown-view";
import { routes } from "@/lib/routes";
import type { DocPage } from "@/server/docs";

type Neighbour = Pick<DocPage, "slug" | "title"> | undefined;

const hrefOf = (slug: string) => (slug === "index" ? routes.docs() : routes.docs(slug));

/** One docs page: its title and summary, the Markdown in a reading column, its outline beside it on wide screens, and the pages either side. */
export function DocArticle({ page, previous, next }: { page: DocPage; previous: Neighbour; next: Neighbour }) {
  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:gap-12">
      <article className="max-w-[72ch] min-w-0">
        <header className="border-b border-rule pb-6">
          <h1 className="text-[1.75rem] leading-[2.15rem] font-bold tracking-title text-ink">{page.title}</h1>
          {page.description && <p className="mt-2 text-md text-ink-2">{page.description}</p>}
        </header>
        <div className="docs-body mt-6">
          <MarkdownView source={page.body} headings="anchored" />
        </div>
        {(previous || next) && (
          <nav aria-label="More docs" className="mt-12 grid gap-3 border-t border-rule pt-6 sm:grid-cols-2">
            {previous && (
              <Link href={hrefOf(previous.slug)} className="group rounded-lg border border-rule bg-panel px-4 py-3 hover:border-edge">
                <span className="flex items-center gap-1 text-xs text-muted">
                  <ArrowLeft aria-hidden className="size-3.5" /> Previous
                </span>
                <span className="mt-0.5 block text-sm font-semibold text-ink group-hover:underline">{previous.title}</span>
              </Link>
            )}
            {next && (
              <Link href={hrefOf(next.slug)} className="group rounded-lg border border-rule bg-panel px-4 py-3 text-right hover:border-edge sm:col-start-2">
                <span className="flex items-center justify-end gap-1 text-xs text-muted">
                  Next <ArrowRight aria-hidden className="size-3.5" />
                </span>
                <span className="mt-0.5 block text-sm font-semibold text-ink group-hover:underline">{next.title}</span>
              </Link>
            )}
          </nav>
        )}
      </article>
      {page.outline.length > 1 && (
        <aside className="hidden xl:block">
          <nav aria-label="On this page" className="sticky top-24">
            <h2 className="text-xs font-semibold text-muted">On this page</h2>
            <ul className="mt-2 space-y-1.5 border-l border-rule">
              {page.outline.map(({ id, title }) => (
                <li key={id}>
                  <a href={`#${id}`} className="-ml-px block border-l border-transparent pl-3 text-sm text-ink-2 hover:border-edge hover:text-ink">
                    {title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      )}
    </div>
  );
}
