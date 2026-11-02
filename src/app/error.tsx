"use client";

import { RotateCcw } from "lucide-react";

import { LogoMark } from "@/components/logo";
import { Button, ButtonLink } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <LogoMark className="size-10" />
      <h1 className="mt-6 text-lg font-semibold text-zinc-900">Something went wrong</h1>
      <p className="mt-1 max-w-sm text-sm text-zinc-500">
        The boulder rolled back down. Try again, and if it keeps happening, share this reference with support.
      </p>
      {error.digest && <code className="mt-3 rounded bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-600">{error.digest}</code>}
      <div className="mt-6 flex gap-2">
        <Button variant="primary" onClick={reset}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
        <ButtonLink href={routes.workspaces()}>Your workspaces</ButtonLink>
      </div>
    </main>
  );
}
