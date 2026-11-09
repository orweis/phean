"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/lib/cx";
import { routes } from "@/lib/routes";

export interface DocsNavSection {
  title: string;
  pages: { slug: string; title: string }[];
}

/** The docs sidebar: sections of pages, the current one marked by a violet bar and `aria-current`, never by colour alone. */
export function DocsNav({ sections }: { sections: DocsNavSection[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Docs" className="space-y-6">
      {sections.map((section) => (
        <div key={section.title}>
          <h2 className="px-3 text-xs font-semibold text-muted">{section.title}</h2>
          <ul className="mt-1.5 space-y-0.5">
            {section.pages.map(({ slug, title }) => {
              const href = slug === "index" ? routes.docs() : routes.docs(slug);
              const current = pathname === href;
              return (
                <li key={slug}>
                  <Link
                    href={href}
                    aria-current={current ? "page" : undefined}
                    data-selected={current || undefined}
                    className={cx(
                      "relative block rounded-md px-3 py-1.5 text-sm",
                      current
                        ? "bg-accent-tint font-semibold text-accent-ink before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent"
                        : "text-ink-2 hover:bg-fill hover:text-ink",
                    )}
                  >
                    {title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
