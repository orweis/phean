import { Check, ChevronsUpDown, LayoutList } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { routes } from "@/lib/routes";
import type { Tenant } from "@/server/domain/context";

import { Logo } from "./logo";
import { SignOutButton } from "./sign-out-button";

function WorkspaceSwitcher({ current, workspaces }: { current: Tenant; workspaces: readonly Tenant[] }) {
  return (
    <details className="group relative min-w-0">
      <summary className="flex h-8 min-w-0 list-none items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-shell-ink hover:bg-shell-2 [&::-webkit-details-marker]:hidden">
        <span className="truncate">{current.name}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-shell-muted" aria-hidden />
      </summary>
      <div className="absolute left-0 z-30 mt-1 w-64 rounded-lg border border-rule bg-panel p-1 text-ink shadow-pop">
        <p className="px-2 pt-1.5 pb-1 text-xs text-muted">Switch workspace</p>
        {workspaces.map((workspace) => (
          <Link
            key={workspace.id}
            href={routes.workspace(workspace.slug)}
            aria-current={workspace.id === current.id ? "page" : undefined}
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-sunken"
          >
            <span className="truncate">{workspace.name}</span>
            {workspace.id === current.id && <Check className="size-3.5 text-move" aria-hidden />}
          </Link>
        ))}
        <Link
          href={routes.workspaces()}
          className="mt-1 flex items-center gap-1.5 rounded-md border-t border-rule px-2 py-1.5 text-sm text-ink-2 hover:bg-sunken"
        >
          <LayoutList className="size-3.5" aria-hidden />
          All workspaces
        </Link>
      </div>
    </details>
  );
}

interface AppHeaderProps {
  user: { name: string; email: string };
  workspace?: { current: Tenant; all: readonly Tenant[] };
  children?: ReactNode;
}

export function AppHeader({ user, workspace, children }: AppHeaderProps) {
  return (
    <header data-shell className="bg-shell text-shell-ink">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Logo href={routes.workspaces()} className="shrink-0" />
        {workspace && (
          <>
            <span className="px-1 text-shell-muted" aria-hidden>
              /
            </span>
            <WorkspaceSwitcher current={workspace.current} workspaces={workspace.all} />
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-right text-xs sm:block">
            <span className="block font-semibold text-shell-ink">{user.name}</span>
            <span className="text-shell-muted">{user.email}</span>
          </span>
          <SignOutButton variant="shell" />
        </div>
      </div>
      {children && <div className="mx-auto max-w-7xl px-4 sm:px-6">{children}</div>}
    </header>
  );
}
