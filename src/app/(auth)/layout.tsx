import type { ReactNode } from "react";

import { Logo } from "@/components/logo";
import { HeroArt } from "@/components/marketing/art";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/*
       * The site's hour beside the form on large screens: the hill the agents climb, the headline on the
       * ground above it, fading out before the form so there is no seam. On a phone just the wordmark, so the form sits high.
       */}
      <aside className="relative isolate flex flex-col gap-14 overflow-hidden px-6 py-8 sm:px-10 lg:py-12">
        <div aria-hidden className="absolute inset-x-0 top-[36%] bottom-0 -z-10 mask-r-from-88% max-lg:hidden">
          <HeroArt decorative sizes="46vw" className="absolute inset-0 size-full object-cover object-[100%_50%]" />
          <div className="auth-fog absolute inset-0" />
        </div>
        <Logo />
        <div className="hidden lg:block">
          <p className="display max-w-md text-[3.25rem] text-ink">AI agents do the tasks. You make the calls.</p>
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
