"use client";

import { BellRing } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { forgetDeviceAction } from "@/app/account/actions";
import { offersPush, PUSH_PROMPT_DISMISSED_KEY } from "@/lib/push-prompt";
import { routes } from "@/lib/routes";

import { browserPushSubscription, pushRegistration, subscribeThisDevice } from "./push-subscription";
import { Button } from "./ui/button";
import { useStatus } from "./ui/status-region";

function dismissedHere(): boolean {
  try {
    return window.localStorage.getItem(PUSH_PROMPT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The Decisions page's offer to turn on notifications for this device (a phone above all, where
 * Phean on Android is this web app): one tap asks for permission and subscribes, as the Account page
 * does. Shown only where that can work and has not happened (`offersPush`); "Not now" hides it on
 * this device. Nothing renders until the browser has been checked, so the page never shifts for
 * someone who already has notifications on.
 */
export function NotificationsPrompt({ publicKey, member }: { publicKey: string | null; member: boolean }) {
  const router = useRouter();
  const status = useStatus();
  const [offered, setOffered] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const desktop = "pheanDesktop" in window;
      const apis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      const supported = apis && !desktop && Boolean(await pushRegistration().catch(() => null));
      return offersPush({
        configured: Boolean(publicKey),
        member,
        desktop,
        supported,
        permission: "Notification" in window ? Notification.permission : "unknown",
        subscribed: supported && Boolean(await browserPushSubscription()),
        dismissed: dismissedHere(),
      });
    })()
      .catch(() => false)
      .then((offer) => {
        if (!cancelled) setOffered(offer);
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey, member]);

  if (!offered || !publicKey) return null;

  async function turnOn() {
    if (!publicKey) return;
    setError(null);
    setPending(true);
    const result = await subscribeThisDevice(publicKey);
    setPending(false);
    if (!result.ok) return setError(result.reason === "no-worker" ? "Notifications are not available on this page yet. Reload it and try again." : result.message);
    setOffered(false);
    const message = `Notifications are on for ${result.label}`;
    if (status) status.announce({ message, undo: { action: forgetDeviceAction, fields: { deviceId: result.deviceId }, done: `Turned notifications off for ${result.label}` } });
    router.refresh();
  }

  function notNow() {
    try {
      window.localStorage.setItem(PUSH_PROMPT_DISMISSED_KEY, "1");
    } catch {
      // Private mode: it hides for this visit only.
    }
    setOffered(false);
  }

  return (
    <section aria-label="Notifications on this device" className="surface flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-rule px-4 py-3">
      <BellRing aria-hidden className="size-5 shrink-0 text-accent-ink" />
      <div className="min-w-0 flex-1 basis-60 text-sm">
        <p className="font-semibold text-ink">Get decisions on this device</p>
        <p className="text-ink-2">
          A notification the moment an agent asks you something, from every workspace you are in. Change it any time on{" "}
          <a href={`${routes.account()}#notifications`} className="link">
            your Account page
          </a>
          .
        </p>
        {error && (
          <p role="alert" className="mt-2 rounded-md border border-late/30 bg-late-tint px-3 py-2 text-late-ink">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" onClick={notNow} disabled={pending}>
          Not now
        </Button>
        <Button variant="tinted" pending={pending} onClick={turnOn}>
          Turn on
        </Button>
      </div>
    </section>
  );
}
