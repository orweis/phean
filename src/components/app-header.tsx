import { Check, ChevronsUpDown, LayoutList } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { routes } from "@/lib/routes";
import type { Tenant } from "@/server/domain/context";
import { getAppearance } from "@/server/web";

import { AppearancePicker } from "./appearance-picker";
import { Logo } from "./logo";
import { SignOutButton } from "./sign-out-button";
import { Avatar } from "./ui/avatar";
import { Popover } from "./ui/popover";

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

interface Viewer {
  name: string;
  email: string;
}

/** Who is signed in, how the app looks for them, and the way out. On phones the trigger is the avatar alone. */
async function AccountMenu({ user }: { user: Viewer }) {
  const appearance = await getAppearance();
  return (
    <Popover
      variant="ghost"
      className="sm:w-72"
      triggerClassName="pl-1 max-sm:pr-1"
      label={
        <>
          <Avatar name={user.name} size="sm" />
          <span className="max-w-40 truncate max-sm:sr-only">{user.name}</span>
        </>
      }
    >
      <div className="flex items-center gap-3">
        <Avatar name={user.name} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
          <p className="truncate text-xs text-ink-2">{user.email}</p>
        </div>
      </div>
      <AppearancePicker initial={appearance} className="mt-4" />
      <div className="mt-4 border-t border-rule pt-3">
        <SignOutButton />
      </div>
    </Popover>
  );
}

interface AppHeaderProps {
  user: Viewer;
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
        <div className="ml-auto">
          <AccountMenu user={user} />
        </div>
      </div>
      {children && <div className="mx-auto max-w-7xl px-4 pb-1 sm:px-6">{children}</div>}
    </header>
  );
}
