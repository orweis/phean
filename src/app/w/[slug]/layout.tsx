import { Eye } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AnalyticsIdentity } from "@/components/analytics";
import { AppHeader } from "@/components/app-header";
import { AutoRefresh } from "@/components/auto-refresh";
import { FaviconBadge } from "@/components/favicon-badge";
import { PeekOriginTracker } from "@/components/peek-analytics";
import { RememberWorkspace } from "@/components/remember-workspace";
import { SearchShortcut } from "@/components/search-shortcut";
import { SkipLink } from "@/components/skip-link";
import { StatusRegion } from "@/components/ui/status-region";
import { WorkspaceFrame } from "@/components/workspace-frame";
import { WorkspaceNav } from "@/components/workspace-nav";
import { analyticsIdentity } from "@/server/analytics";
import { requireWorkspace, visibleWorkspaces } from "@/server/auth/session";
import { getWorkspaceStats } from "@/server/domain/overview";

export async function generateMetadata({ params }: LayoutProps<"/w/[slug]">): Promise<Metadata> {
  const { membership } = await requireWorkspace((await params).slug);
  return { title: { default: membership.tenant.name, template: `%s | ${membership.tenant.name} | Phean` } };
}

export default async function WorkspaceLayout({ children, peek, params }: LayoutProps<"/w/[slug]">) {
  const { slug } = await params;
  const { viewer, membership, ctx } = await requireWorkspace(slug);
  const [workspaces, stats] = await Promise.all([
    visibleWorkspaces(viewer).then((visible) => visible.map((entry) => entry.tenant)),
    getWorkspaceStats(ctx.db, [ctx.tenant.id]).then((byTenant) => byTenant.get(ctx.tenant.id)!),
  ]);

  return (
    <StatusRegion>
      <SkipLink />
      <AnalyticsIdentity {...analyticsIdentity(viewer, membership)} />
      <AutoRefresh waiting={stats.waitingOnYou} />
      <FaviconBadge count={stats.waitingOnYou + stats.inbox} />
      <SearchShortcut slug={slug} />
      <RememberWorkspace slug={slug} />
      <Suspense fallback={null}>
        <PeekOriginTracker />
      </Suspense>
      {/* The header and tab rail, which a focused flow such as Quick Decisions leaves out for the whole screen. */}
      <WorkspaceFrame
        chrome={
          <>
            <AppHeader user={viewer.user} workspace={{ current: membership.tenant, all: workspaces }}>
              <WorkspaceNav slug={slug} counts={{ waitingOnYou: stats.waitingOnYou, decisions: stats.waitingOnYou, inbox: stats.inbox }} />
            </AppHeader>
            {membership.role === "platform_admin" && (
              <p className="flex items-center justify-center gap-1.5 border-b border-wait/50 bg-wait-tint px-4 py-2 text-xs font-semibold text-wait-ink">
                <Eye className="size-3.5" aria-hidden />
                You are viewing this workspace as a platform admin. It is read-only for you.
              </p>
            )}
          </>
        }
      >
        {children}
      </WorkspaceFrame>
      {/* A task or document opened over the page: see the @peek slot. */}
      {peek}
    </StatusRegion>
  );
}
