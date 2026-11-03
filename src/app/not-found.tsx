import type { Metadata } from "next";

import { LogoMark } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <LogoMark className="size-12" />
      <h1 className="mt-6 text-xl font-bold text-ink">Nothing here</h1>
      <p className="mt-1 max-w-sm text-sm text-ink-2">
        This page does not exist, or it belongs to a workspace you are not a member of.
      </p>
      <ButtonLink href={routes.workspaces()} variant="primary" className="mt-6">
        Go to your workspaces
      </ButtonLink>
    </main>
  );
}
