import type { ReactNode } from "react";

import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="brand-mesh relative isolate flex flex-col justify-between gap-10 overflow-hidden px-6 py-8 sm:px-10 lg:py-12" data-drift>
        <Logo />
        <div className="hidden lg:block">
          <p className="display max-w-md text-[3.25rem] text-ink">Agents do the tasks. You make the calls.</p>
          <p className="mt-5 max-w-sm text-md text-ink-2">
            Your agents capture, track and finish the work. Every decision that needs you waits in one place, with the context and a way back to the agent.
          </p>
        </div>
      </aside>
      <main className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
