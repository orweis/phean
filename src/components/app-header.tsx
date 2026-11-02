import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { routes } from "@/lib/routes";
import type { Tenant } from "@/server/domain/context";

import { Logo } from "./logo";
import { SignOutButton } from "./sign-out-button";

function WorkspaceSwitcher({ current, workspaces }: { current: Tenant; workspaces: readonly Tenant[] }) {
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-zinc-900 hover:bg-zinc-100 [&::-webkit-details-marker]:hidden">
        {current.name}
        <ChevronsUpDown className="size-3.5 text-zinc-400" aria-hidden />
      </summary>
      <div className="absolute left-0 z-20 mt-1 w-64 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
        <p className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Workspaces</p>
        {workspaces.map((workspace) => (
          <Link
            key={workspace.id}
            href={routes.workspace(workspace.slug)}
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            <span className="truncate">{workspace.name}</span>
            {workspace.id === current.id && <Check className="size-3.5 text-zinc-500" aria-hidden />}
          </Link>
        ))}
        <Link
          href={routes.workspaces()}
          className="mt-1 flex items-center gap-1.5 rounded-md border-t border-zinc-100 px-2 py-1.5 text-sm text-zinc-500 hover:bg-zinc-50"
        >
          <Plus className="size-3.5" aria-hidden />
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
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Logo href={routes.workspaces()} />
        {workspace && (
          <>
            <span className="text-zinc-300" aria-hidden>
              /
            </span>
            <WorkspaceSwitcher current={workspace.current} workspaces={workspace.all} />
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-right text-xs leading-tight sm:block">
            <span className="block font-medium text-zinc-900">{user.name}</span>
            <span className="text-zinc-500">{user.email}</span>
          </span>
          <SignOutButton />
        </div>
      </div>
      {children && <div className="mx-auto max-w-7xl px-4 sm:px-6">{children}</div>}
    </header>
  );
}
