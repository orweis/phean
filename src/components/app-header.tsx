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
      <summary className="flex h-8 min-w-0 list-none items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-ink transition-colors duration-(--dur-micro) hover:bg-fill group-open:bg-fill [&::-webkit-details-marker]:hidden">
        <span className="truncate">{current.name}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted" aria-hidden />
      </summary>
      <div className="glass-float absolute left-0 z-30 mt-2 w-64 origin-top-left rounded-xl p-1.5 text-ink motion-safe:animate-glass-in max-sm:fixed max-sm:inset-x-3 max-sm:top-14 max-sm:mt-0 max-sm:w-auto">
        <p className="px-2.5 pt-1.5 pb-1 text-xs text-muted">Switch workspace</p>
        {workspaces.map((workspace) => (
          <Link
            key={workspace.id}
            href={routes.workspace(workspace.slug)}
            aria-current={workspace.id === current.id ? "page" : undefined}
            className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm hover:bg-fill"
          >
            <span className="truncate">{workspace.name}</span>
            {workspace.id === current.id && <Check className="size-3.5 text-accent-ink" aria-hidden />}
          </Link>
        ))}
        <Link
          href={routes.workspaces()}
          className="mt-1 flex items-center gap-1.5 rounded-md border-t border-rule px-2.5 py-1.5 text-sm text-ink-2 hover:bg-fill"
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

/** The functional layer: a Liquid Glass bar that stays on top while the ledger scrolls beneath it. */
export function AppHeader({ user, workspace, children }: AppHeaderProps) {
  return (
    <header className="glass-bar text-ink">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Logo href={routes.workspaces()} className="shrink-0" />
        {workspace && (
          <>
            <span className="px-0.5 text-faint" aria-hidden>
              /
            </span>
            <WorkspaceSwitcher current={workspace.current} workspaces={workspace.all} />
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-right text-xs sm:block">
            <span className="block font-semibold text-ink">{user.name}</span>
            <span className="text-ink-2">{user.email}</span>
          </span>
          <SignOutButton />
        </div>
      </div>
      {children && <div className="mx-auto max-w-7xl px-4 pb-1 sm:px-6">{children}</div>}
    </header>
  );
}
