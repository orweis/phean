import type { ReactNode } from "react";

import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside data-shell className="flex flex-col justify-between gap-10 bg-shell px-6 py-8 text-shell-ink sm:px-10 lg:py-12">
        <Logo />
        <div className="hidden lg:block">
          <p className="max-w-md text-[2.5rem] leading-[1.05] font-extrabold font-stretch-condensed">Humans set the goals. Agents roll the boulder.</p>
          <p className="mt-4 max-w-sm text-sm text-shell-muted">
            Your agents capture the work and move it along the line. You approve what they propose and read where everything stands.
          </p>
        </div>
      </aside>
      <main className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
