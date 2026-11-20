import Link from "next/link";

import { LogoMark, Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { getSession } from "@/server/auth/session";

/** The blog: the site's glass bar with the blog's name in it, the page, and a footer that leads back to the product. */
export default async function BlogLayout({ children }: LayoutProps<"/blog">) {
  const session = await getSession();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="glass-bar text-ink">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
          <Logo className="shrink-0" />
          <span className="px-0.5 text-faint" aria-hidden>
            /
          </span>
          <Link href={routes.blog()} className="text-sm font-semibold text-ink-2 hover:text-ink">
            Blog
          </Link>
          <nav aria-label="Account" className="ml-auto flex items-center gap-1">
            <ButtonLink href={routes.docs()} variant="ghost" className="max-sm:hidden">
              Docs
            </ButtonLink>
            {session ? (
              <ButtonLink href={routes.workspaces()} variant="ghost">
                Open Phean
              </ButtonLink>
            ) : (
              <>
                <ButtonLink href={routes.signIn()} variant="ghost" className="max-sm:hidden">
                  Sign in
                </ButtonLink>
                <ButtonLink href={routes.signUp()} variant="primary">
                  Get started
                </ButtonLink>
              </>
            )}
          </nav>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="flex items-center gap-2 text-sm text-ink-2">
            <LogoMark className="size-5" />
            <span>
              <span className="font-display font-bold text-ink">Phean</span>: the decision center for your fleet of AI agents.
            </span>
          </p>
          <nav aria-label="Blog footer">
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {[
                { href: routes.home(), label: "Home" },
                { href: routes.blog(), label: "Blog" },
                { href: routes.blogFeed(), label: "RSS" },
                { href: routes.docs(), label: "Docs" },
                { href: routes.privacy(), label: "Privacy" },
              ].map(({ href, label }) => (
                <li key={label}>
                  <Link href={href} className="text-ink-2 link hover:text-ink" prefetch={label === "RSS" ? false : undefined}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}
