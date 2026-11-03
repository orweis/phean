"use client";

import { RotateCcw } from "lucide-react";

import { LogoMark } from "@/components/logo";
import { Button, ButtonLink } from "@/components/ui/button";
import { routes } from "@/lib/routes";

/** What an error boundary shows: a retry, a way out, and the reference support can look up. */
export function ErrorNotice({ digest, reset }: { digest?: string; reset: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <LogoMark className="size-12" />
      <h1 className="mt-6 text-xl font-bold text-ink">Something went wrong</h1>
      <p className="mt-1 max-w-sm text-sm text-ink-2">
        The boulder rolled back down. Try again, and if it keeps happening, share this reference with support.
      </p>
      {digest && <code className="mt-3 rounded-sm bg-fill px-2 py-1 font-mono text-xs text-ink-2">{digest}</code>}
      <div className="mt-6 flex gap-2">
        <Button variant="primary" onClick={reset}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
        <ButtonLink href={routes.workspaces()}>Your workspaces</ButtonLink>
      </div>
    </div>
  );
}
