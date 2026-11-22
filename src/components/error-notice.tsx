"use client";

import { RotateCcw, WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

import { LogoMark } from "@/components/logo";
import { Button, ButtonLink } from "@/components/ui/button";
import { routes } from "@/lib/routes";

/** The reference a server error carries for support; a client error has none. */
export function errorDigest(error: unknown): string | undefined {
  return error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : undefined;
}

function subscribeToConnection(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Whether the browser says it has no network; the server, which cannot tell, assumes it has. */
function useOffline() {
  return useSyncExternalStore(
    subscribeToConnection,
    () => !navigator.onLine,
    () => false,
  );
}

/**
 * What an error boundary shows: a retry, a way out, and the reference support can look up. A page
 * that failed because the device lost its network (a link followed offline) says so, since the
 * service worker's offline page only covers full page loads. Try again is the boundary's `retry`,
 * which fetches the page again; `reset` would only re-render what failed to load.
 */
export function ErrorNotice({ digest, retry }: { digest?: string; retry: () => void }) {
  const offline = useOffline();
  return (
    <div className="flex flex-col items-center text-center">
      <LogoMark className="size-12" />
      <h1 className="mt-6 flex items-center gap-2 text-xl font-bold text-ink">
        {offline && <WifiOff aria-hidden className="size-5" />}
        {offline ? "You are offline" : "Something went wrong"}
      </h1>
      <p className="mt-1 max-w-sm text-sm text-ink-2">
        {offline
          ? "Phean cannot be reached from this device right now. Try again once you are back online."
          : digest
            ? "Phean hit an error loading this page. Try again, and if it keeps happening, share this reference with support."
            : "Phean hit an error loading this page. Try again, and if it keeps happening, tell support what you were doing."}
      </p>
      {digest && !offline && <code className="mt-3 rounded-sm bg-fill px-2 py-1 font-mono text-xs text-ink-2">{digest}</code>}
      <div className="mt-6 flex gap-2">
        <Button variant="primary" onClick={retry}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
        <ButtonLink href={routes.workspaces()}>Your workspaces</ButtonLink>
      </div>
    </div>
  );
}
