import { ArrowUpRight, Bot } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AgentMark, AGENTS } from "@/components/marketing/agent-logo";
import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";
import { cx } from "@/lib/cx";
import { routes } from "@/lib/routes";
import { hasSessionCookie } from "@/server/auth/session";

import { MobileMenu } from "./mobile-menu";
import { NavMenu } from "./nav-menu";
import { SiteClicks } from "./site-analytics";
import { AGENT_LINKS, DEVELOPER_LINKS, GITHUB_URL, PRODUCT, RESOURCE_LINKS, USE_CASE_LINKS, type SiteGroup, type SiteLink, type SiteSection } from "./site-links";

/** An agent's mark beside its link in the Agents menu, where it has one. */
function markFor(link: SiteLink) {
  const agent = AGENTS.find((candidate) => link.href === routes.docs(candidate.docs));
  // An agent without a mark of its own, and your own bot, take the generic bot so every label lines up.
  return agent?.mark ? <AgentMark mark={agent.mark} name={agent.name} className="size-4 text-ink-2" /> : <Bot aria-hidden className="size-4 text-ink-2" />;
}

/** A row in a desktop menu: the label, and the one line that says what is behind it. */
function MenuLink({ link, icon }: { link: SiteLink; icon?: ReactNode }) {
  return (
    <Link href={link.href} className="flex gap-3 rounded-lg px-3 py-2.5 hover:bg-fill focus-visible:bg-fill">
      {icon && <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{link.label}</span>
        {link.description && <span className="mt-0.5 block text-xs leading-snug text-muted">{link.description}</span>}
      </span>
    </Link>
  );
}

/** A menu's links; the button that opens it already names the group. `columns` sets two across. */
function MenuColumn({ group, icons = false, columns = 1 }: { group: SiteGroup; icons?: boolean; columns?: 1 | 2 }) {
  return (
    <div className="min-w-0">
      <ul aria-label={group.title} className={cx(columns === 2 && "grid grid-cols-2")}>
        {group.links.map((link) => (
          <li key={link.href}>
            <MenuLink link={link} icon={icons ? markFor(link) : undefined} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A link in the bar itself, marked as the section you are in by `aria-current` and a tint, not colour alone. */
function BarLink({ href, label, current }: { href: string; label: string; current: boolean }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cx(
        "inline-flex h-9 items-center rounded-full px-3.5 text-sm font-semibold",
        current ? "bg-accent-tint text-accent-ink" : "text-ink-2 hover:bg-fill hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
}

/** The sheet's version of a group: a heading and its links as large tap targets, two across where there is room. */
function SheetGroup({ group }: { group: SiteGroup }) {
  return (
    <section aria-label={group.title}>
      <h2 className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">{group.title}</h2>
      <ul className="mt-2 grid gap-x-4 sm:grid-cols-2">
        {group.links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="flex min-h-11 items-center gap-1 border-b border-rule/70 text-md font-semibold text-ink"
            >
              {link.label}
              {link.external && <ArrowUpRight aria-hidden className="size-4 text-muted" />}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The marketing site's bar, on the landing page, the docs, the blog and the legal pages: the logo,
 * the Product, Use cases and Agents menus, Docs and Blog, and the account buttons. Under 1024px the
 * menus fold into one sheet holding the whole site map. Every link is in the HTML from the server.
 */
export async function SiteHeader({ current, wide = true }: { current: SiteSection; wide?: boolean }) {
  const signedIn = await hasSessionCookie();
  const start = signedIn ? { href: routes.app(), label: "Open Phean", cta: "nav_open_phean" } : { href: routes.signUp(), label: "Get started", cta: "nav_get_started" };

  return (
    <header className="glass-bar text-ink">
      <SiteClicks />
      <div className={cx("mx-auto flex h-16 items-center gap-2 px-4 sm:px-6", wide ? "max-w-7xl" : "max-w-5xl")}>
        <Logo className="shrink-0 lg:mr-4" />
        <nav aria-label="Site" className="flex items-center gap-0.5 max-lg:hidden">
          <NavMenu label="Product">
            <div className="w-[38rem]">
              <MenuColumn group={PRODUCT} columns={2} />
            </div>
          </NavMenu>
          <NavMenu label="Use cases">
            <div className="w-[24rem]">
              <MenuColumn group={USE_CASE_LINKS} />
            </div>
          </NavMenu>
          <NavMenu label="Agents">
            <div className="w-[22rem]">
              <MenuColumn group={AGENT_LINKS} icons />
            </div>
          </NavMenu>
          <BarLink href={routes.docs()} label="Docs" current={current === "docs"} />
          <BarLink href={routes.blog()} label="Blog" current={current === "blog"} />
        </nav>

        <nav aria-label="Account" className="ml-auto flex items-center gap-1 sm:gap-2">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center rounded-full px-3 text-sm font-semibold text-ink-2 hover:bg-fill hover:text-ink max-xl:hidden"
          >
            GitHub<span className="sr-only"> (opens in a new tab)</span>
          </a>
          {!signedIn && (
            <ButtonLink href={routes.signIn()} variant="ghost" className="max-sm:hidden" data-cta="nav_sign_in" data-cta-location="nav">
              Sign in
            </ButtonLink>
          )}
          <ButtonLink href={start.href} variant="primary" data-cta={start.cta} data-cta-location="nav">
            {start.label}
          </ButtonLink>
        </nav>

        <MobileMenu>
          <nav aria-label="Menu" className="mx-auto grid max-w-3xl gap-8 px-4 pt-6 pb-12 sm:px-6">
            <ul className="grid grid-cols-2 gap-2">
              {[
                { href: routes.docs(), label: "Docs", here: current === "docs" },
                { href: routes.blog(), label: "Blog", here: current === "blog" },
              ].map(({ href, label, here }) => (
                <li key={label}>
                  <Link
                    href={href}
                    aria-current={here ? "page" : undefined}
                    className={cx("flex h-12 items-center justify-center rounded-lg text-md font-semibold ring-1 ring-rule", here ? "bg-accent-tint text-accent-ink" : "bg-panel text-ink")}
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
            {[PRODUCT, USE_CASE_LINKS, AGENT_LINKS, DEVELOPER_LINKS, RESOURCE_LINKS].map((group) => (
              <SheetGroup key={group.title} group={group} />
            ))}
            {!signedIn && (
              <div className="grid grid-cols-2 gap-2">
                <ButtonLink href={routes.signIn()} variant="secondary" size="lg" data-cta="nav_sign_in" data-cta-location="nav">
                  Sign in
                </ButtonLink>
                <ButtonLink href={routes.signUp()} variant="primary" size="lg" data-cta="nav_get_started" data-cta-location="nav">
                  Get started
                </ButtonLink>
              </div>
            )}
          </nav>
        </MobileMenu>
      </div>
    </header>
  );
}
