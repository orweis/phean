import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { ConsentLink } from "@/components/analytics";
import { AppearancePicker } from "@/components/appearance-picker";
import { LogoMark } from "@/components/logo";
import { ThemePicker } from "@/components/theme-picker";
import { routes } from "@/lib/routes";
import { loadPosts } from "@/server/blog";
import { getAppearance, getTheme } from "@/server/web";

import { AGENT_LINKS, DEVELOPER_LINKS, GITHUB_URL, PRODUCT, RESOURCE_LINKS, USE_CASE_LINKS, type SiteGroup } from "./site-links";

function FooterColumn({ group }: { group: SiteGroup }) {
  const id = `footer-${group.title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <nav aria-labelledby={id} className="min-w-0">
      <h2 id={id} className="text-sm font-semibold text-ink">
        {group.title}
      </h2>
      <ul className="mt-3 space-y-2.5 text-sm">
        {group.links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="inline-flex items-center gap-1 text-ink-2 hover:text-ink hover:underline"
            >
              {link.label}
              {link.external && (
                <>
                  <ArrowUpRight aria-hidden className="size-3.5 text-muted" />
                  <span className="sr-only">(opens in a new tab)</span>
                </>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The marketing site's footer: the whole site map in columns (product, use cases, agents, developers,
 * resources with the newest stories), then the brand line, the theme and appearance pickers, and the
 * licence. Under 640px the columns pair up, two across.
 */
export async function SiteFooter() {
  const [posts, theme, appearance] = await Promise.all([loadPosts(), getTheme(), getAppearance()]);
  const latest: SiteGroup = { title: "From the blog", links: posts.slice(0, 3).map((post) => ({ href: routes.blog(post.slug), label: post.title })) };

  return (
    <footer className="border-t border-rule bg-fill/40">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <div>
            <Link href={routes.home()} className="inline-flex items-center gap-2 font-display text-lg font-bold text-ink">
              <LogoMark className="size-6" />
              Phean
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-2">
              The decision center for your fleet of AI agents and personal assistants. Agents do the tasks; you make the calls.
            </p>
            <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <Link href={routes.signUp()} className="font-semibold link" data-cta="footer_create_workspace" data-cta-location="footer">
                Create a workspace
              </Link>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="text-ink-2 link hover:text-ink">
                Star on GitHub<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 xl:grid-cols-5">
            <FooterColumn group={PRODUCT} />
            <FooterColumn group={USE_CASE_LINKS} />
            <FooterColumn group={AGENT_LINKS} />
            <FooterColumn group={DEVELOPER_LINKS} />
            <div className="col-span-2 grid grid-cols-2 gap-x-6 gap-y-10 sm:col-span-1 sm:grid-cols-1">
              <FooterColumn group={RESOURCE_LINKS} />
              {latest.links.length > 0 && <FooterColumn group={latest} />}
            </div>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-6 border-t border-rule pt-8 md:flex-row md:items-end md:justify-between">
          <p className="text-sm text-muted">
            Phean is open source under the MIT license. Names and marks of agents are their makers&apos; trademarks.{" "}
            <ConsentLink className="link text-ink-2 hover:text-ink" />
          </p>
          <div className="grid w-full gap-4 sm:w-80">
            <ThemePicker initial={theme} compact />
            <AppearancePicker initial={appearance} />
          </div>
        </div>
      </div>
    </footer>
  );
}
