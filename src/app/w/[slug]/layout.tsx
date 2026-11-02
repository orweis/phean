import { Eye } from "lucide-react";
import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { AutoRefresh } from "@/components/auto-refresh";
import { WorkspaceNav } from "@/components/workspace-nav";
import { requireWorkspace, visibleWorkspaces } from "@/server/auth/session";

export async function generateMetadata({ params }: LayoutProps<"/w/[slug]">): Promise<Metadata> {
  const { membership } = await requireWorkspace((await params).slug);
  return { title: { default: membership.tenant.name, template: `%s · ${membership.tenant.name} · Phean` } };
}

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  const { slug } = await params;
  const { viewer, membership } = await requireWorkspace(slug);
  const workspaces = (await visibleWorkspaces(viewer)).map((visible) => visible.tenant);

  return (
    <>
      <AppHeader user={viewer.user} workspace={{ current: membership.tenant, all: workspaces }}>
        <WorkspaceNav slug={slug} />
      </AppHeader>
      {membership.role === "platform_admin" && (
        <p className="flex items-center justify-center gap-1.5 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <Eye className="size-3.5" aria-hidden />
          You are viewing this workspace as a platform admin. It is read-only for you.
        </p>
      )}
      <AutoRefresh />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </>
  );
}
