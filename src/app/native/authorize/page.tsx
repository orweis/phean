import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { queryParam, routes } from "@/lib/routes";
import { auth } from "@/server/auth/auth";
import { findNativeRequest } from "@/server/auth/native";
import { getSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in to Phean desktop" };

function DialogPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-8">
      <Logo />
      <Card className="px-4 py-5 sm:px-5">
        <h1 className="text-lg font-bold wrap-anywhere text-ink">{title}</h1>
        {children}
      </Card>
    </main>
  );
}

/**
 * The browser half of the desktop app's sign-in. The app registered the request and shows the same
 * confirmation code; confirming here needs a full session (two-factor done) and sends the browser back
 * to the app's loopback address through the confirm route's 303.
 */
export default async function NativeAuthorizePage({ searchParams }: PageProps<"/native/authorize">) {
  const requestId = queryParam((await searchParams).request) ?? "";
  const request = await findNativeRequest(auth, requestId);
  if (!request) {
    return (
      <DialogPage title="This sign-in request has expired">
        <p className="mt-1 text-sm text-ink-2">
          It was already used, or it is more than ten minutes old, or it did not come from the Phean desktop app. Nothing was signed in. Start again from the app.
        </p>
      </DialogPage>
    );
  }

  // A pending two-factor challenge has no session, so it signs in again here and comes back.
  const session = await getSession();
  if (!session) redirect(routes.signIn(routes.nativeAuthorize(requestId)));

  return (
    <DialogPage title={`Sign in to Phean desktop as ${session.user.name}?`}>
      <p className="mt-1 text-sm text-ink-2">
        The desktop app on this computer asked to sign in as <strong className="font-semibold wrap-anywhere text-ink">{session.user.email}</strong>. Continue only if you
        started it, and the app shows the same code.
      </p>
      <dl className="mt-5 rounded-md bg-fill px-4 py-3 text-center">
        <dt className="text-xs text-muted">Code in the app</dt>
        <dd className="figure text-3xl font-bold tracking-widest text-ink" data-confirmation>
          {request.confirmation}
        </dd>
      </dl>
      <form method="post" action={routes.nativeConfirm()} className="mt-5 flex flex-col gap-2">
        <input type="hidden" name="request" value={requestId} />
        <Button type="submit" name="decision" value="allow" variant="primary" className="w-full">
          Sign in to Phean desktop
        </Button>
        <Button type="submit" name="decision" value="decline" variant="ghost" className="w-full">
          Not me, cancel
        </Button>
      </form>
      <p className="mt-4 text-xs text-muted">Signed in as {session.user.name} in this browser</p>
    </DialogPage>
  );
}
