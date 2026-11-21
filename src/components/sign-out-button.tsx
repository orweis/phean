"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { forgetBrowserDeviceAction } from "@/app/account/actions";
import { authClient } from "@/lib/auth-client";
import { routes } from "@/lib/routes";

import { browserPushSubscription } from "./push-subscription";
import { Button, type ButtonVariant } from "./ui/button";

/**
 * Signing out of this browser ends its notifications too: the server forgets its device (by
 * endpoint, whatever session it was tied to) and the browser drops the subscription, so the next
 * person here hears nothing of this one's decisions. Neither failing stops the sign-out.
 */
async function stopNotificationsHere(): Promise<void> {
  const subscription = await browserPushSubscription();
  if (!subscription) return;
  await forgetBrowserDeviceAction(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe().catch(() => false);
}

export function SignOutButton({ redirectTo = routes.home(), label = "Sign out", variant = "ghost" }: { redirectTo?: string; label?: string; variant?: ButtonVariant }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await stopNotificationsHere();
          await authClient.signOut();
          router.push(redirectTo);
          router.refresh();
        })
      }
    >
      <LogOut aria-hidden />
      {label}
    </Button>
  );
}
