import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { AdminNav } from "@/components/backoffice/admin-nav";
import { SkipLink } from "@/components/skip-link";
import { StatusRegion } from "@/components/ui/status-region";
import { routes } from "@/lib/routes";
import { ADMIN_PAGES } from "@/server/backoffice/paths";
import { requireBackoffice } from "@/server/backoffice/session";
import { getViewer } from "@/server/auth/session";

/** Never indexed, and `robots` disallows the path too. */
export const metadata: Metadata = {
  title: { default: "Backoffice", template: "%s · Backoffice · Phean" },
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Phean's own console over every workspace. Anyone who is not a platform admin gets the same 404 as
 * a missing page (`requireBackoffice`); an admin without two-factor is asked to turn it on, and when
 * `PHEAN_ADMIN_REQUIRE_2FA` is on, the pages show nothing until they do.
 */
export default async function BackofficeLayout({ children }: LayoutProps<"/admin">) {
  const access = await requireBackoffice();
  const { user } = await getViewer();
  return (
    <StatusRegion>
      <SkipLink />
      <AppHeader user={user}>
        <AdminNav tabs={ADMIN_PAGES} />
      </AppHeader>
      <p className="flex items-center justify-center gap-1.5 border-b border-rule bg-fill px-4 py-2 text-center text-xs text-ink-2">
        Backoffice: read-only, across every workspace. Every page you open is recorded.
      </p>
      {!access.twoFactorEnabled && !access.refusal && (
        <p role="note" className="flex flex-wrap items-center justify-center gap-x-1.5 border-b border-wait/50 bg-wait-tint px-4 py-2 text-center text-xs font-semibold text-wait-ink">
          <ShieldAlert className="size-3.5" aria-hidden />
          Your account has no two-factor. The backoffice shows every customer&apos;s data:
          <Link href={routes.account()} className="link underline">
            turn it on
          </Link>
        </p>
      )}
      <main id="content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 outline-none sm:px-6 sm:py-8">
        {children}
      </main>
    </StatusRegion>
  );
}
