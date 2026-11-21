"use client";

import { BellRing } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { forgetDeviceAction, registerDeviceAction, setDeviceOptionsAction, tieDeviceAction } from "@/app/account/actions";
import { deviceLabel } from "@/lib/device-label";
import { PUSH_MAX_DEVICES } from "@/lib/push";

import { ActionButton } from "../ui/action-button";
import { ActionForm } from "../ui/action-form";
import { Button } from "../ui/button";
import { useStatus } from "../ui/status-region";

export interface DeviceSummary {
  id: string;
  label: string;
  endpoint: string;
  answerFromNotification: boolean;
  private: boolean;
  signedIn: boolean;
}

interface PushDeviceSettingsProps {
  /** The server's VAPID public key, or null when notifications are not configured. */
  publicKey: string | null;
  devices: DeviceSummary[];
  /** Whether the person is a member anywhere; notifications are a member's. */
  canSubscribe: boolean;
}

/** Where this browser stands: still looking, no Web Push here, inside the desktop app, no service worker yet, or able to subscribe. */
type Support = "checking" | "unsupported" | "desktop" | "no-worker" | "ready";

/** The VAPID key as the Push API takes it. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

/** The service worker's registration, if the page has one; `ready` alone would wait forever without it. */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!(await navigator.serviceWorker.getRegistration())) return null;
  return navigator.serviceWorker.ready;
}

function OptionToggle({ device, name, title, hint, on, notice }: { device: DeviceSummary; name: "answerFromNotification" | "private"; title: string; hint: string; on: boolean; notice: string }) {
  return (
    <ActionForm key={`${name}-${on}`} action={setDeviceOptionsAction} notice={notice}>
      <input type="hidden" name="deviceId" value={device.id} />
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" name={name} value="true" defaultChecked={on} onChange={(event) => event.currentTarget.form?.requestSubmit()} className="mt-0.5 size-4 shrink-0 accent-accent" />
        <span className="min-w-0">
          <span className="font-semibold text-ink">{title}</span>
          <span className="block text-ink-2">{hint}</span>
        </span>
      </label>
      {/* Read when the box is unticked; a ticked box's "true" comes first. */}
      <input type="hidden" name={name} value="false" />
    </ActionForm>
  );
}

function ForgetButton({ device, here }: { device: DeviceSummary; here: boolean }) {
  return (
    <ActionButton
      action={forgetDeviceAction}
      fields={{ deviceId: device.id }}
      size="sm"
      variant={here ? "secondary" : "ghost"}
      confirm={`Stop notifications on ${device.label}? Turn them on again from that browser.`}
      notice={`Forgot ${device.label}`}
      aria-label={here ? undefined : `Forget ${device.label}`}
    >
      {here ? "Forget this device" : "Forget"}
    </ActionButton>
  );
}

/**
 * Decision notifications for this browser: turn them on (the Push API, through Phean's service
 * worker), choose what a lock screen may show, or forget the device. Other devices are listed so
 * one left behind can be forgotten from here.
 */
export function PushDeviceSettings({ publicKey, devices, canSubscribe }: PushDeviceSettingsProps) {
  const router = useRouter();
  const status = useStatus();
  const [support, setSupport] = useState<Support>("checking");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const subscription = useRef<PushSubscription | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if ("pheanDesktop" in window) return "desktop" as const;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported" as const;
      const ready = await registration();
      if (!ready) return "no-worker" as const;
      subscription.current = await ready.pushManager.getSubscription();
      return "ready" as const;
    })()
      .catch(() => "unsupported" as const)
      .then((found) => {
        if (cancelled) return;
        setEndpoint(subscription.current?.endpoint ?? null);
        setSupport(found);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const here = endpoint ? devices.find((device) => device.endpoint === endpoint) : undefined;
  const others = devices.filter((device) => device !== here);

  // This device was turned on in a session that has since ended (it expired, say): tie it to this one.
  // Every page load does this too (`ServiceWorker`); here the list then shows it.
  const refreshing = useRef(false);
  useEffect(() => {
    if (!here || here.signedIn || refreshing.current) return;
    refreshing.current = true;
    void tieDeviceAction(here.endpoint).then(() => router.refresh());
  }, [here, router]);

  async function turnOn() {
    if (!publicKey) return;
    setError(null);
    setPending(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError(
          permission === "denied"
            ? "Notifications are blocked for Phean in this browser's settings. Allow them there, then try again."
            : "Allow notifications when your browser asks, to get them here.",
        );
        return;
      }
      const ready = await registration();
      if (!ready) return setSupport("no-worker");
      const key = keyBytes(publicKey);
      let current = await ready.pushManager.getSubscription();
      // A subscription made for another key (the server's keys changed) can never be written to.
      if (current && !sameKey(current, key)) {
        await current.unsubscribe();
        current = null;
      }
      current ??= await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      subscription.current = current;
      const label = deviceLabel(navigator.userAgent);
      const result = await registerDeviceAction({ ...current.toJSON(), label });
      if (!result.ok) return setError(result.message);
      setEndpoint(current.endpoint);
      const message = `Notifications are on for ${result.label}`;
      if (status) status.announce({ message, undo: { action: forgetDeviceAction, fields: { deviceId: result.deviceId }, done: `Turned notifications off for ${result.label}` } });
      router.refresh();
    } catch {
      setError("This browser could not subscribe to notifications. Try again, or use another browser.");
    } finally {
      setPending(false);
    }
  }

  const note = (text: string) => <p className="text-sm text-ink-2">{text}</p>;

  return (
    <div className="space-y-5">
      {!publicKey ? (
        note("Notifications are not configured on this Phean server yet, so nothing can be sent. Whoever runs it turns them on with a VAPID key pair.")
      ) : !canSubscribe ? (
        note("Join a workspace to get its decisions here.")
      ) : support === "checking" ? (
        note("Checking this browser…")
      ) : support === "desktop" ? (
        note("Phean desktop shows decisions itself, from the tray. There is nothing to turn on here.")
      ) : support === "unsupported" ? (
        note("This browser cannot show notifications from websites. Try Chrome, Edge, Firefox or Safari, or install Phean as an app.")
      ) : support === "no-worker" ? (
        note("Notifications are not available on this page yet. Reload it and try again.")
      ) : here ? (
        <div className="space-y-4">
          <p className="text-sm text-ink">
            On for <span className="font-semibold">{here.label}</span>. Every workspace you are in notifies you here; mute one from its Decisions page.
          </p>
          <OptionToggle
            device={here}
            name="answerFromNotification"
            on={here.answerFromNotification}
            title="Answer from notifications"
            hint="Shows a decision's first two options as buttons. Anyone holding your locked phone could tap one."
            notice={here.answerFromNotification ? `${here.label} no longer shows answer buttons` : `${here.label} shows answer buttons now`}
          />
          <OptionToggle
            device={here}
            name="private"
            on={here.private}
            title="Private notifications"
            hint="Says only that a decision is waiting, and where. Nothing an agent wrote shows on your lock screen."
            notice={here.private ? `${here.label} shows the question again` : `${here.label} keeps decisions private now`}
          />
          <ForgetButton device={here} here />
        </div>
      ) : (
        <div className="space-y-3">
          {note(
            `Get a notification the moment an agent asks you to decide something, from every workspace you are in. Up to ${PUSH_MAX_DEVICES} devices at once: turning on another forgets the one turned on longest ago.`,
          )}
          {error && (
            <p role="alert" className="rounded-md border border-late/30 bg-late-tint px-3 py-2 text-sm text-late-ink">
              {error}
            </p>
          )}
          <Button variant="primary" pending={pending} onClick={turnOn}>
            {!pending && <BellRing aria-hidden />}
            Notify me on this device
          </Button>
        </div>
      )}
      {others.length > 0 && (
        <div className="space-y-2 border-t border-rule pt-4">
          <h3 className="text-sm font-semibold text-ink">Your other devices</h3>
          <ul className="divide-y divide-rule">
            {others.map((device) => (
              <li key={device.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0 text-sm">
                  <p className="truncate text-ink">{device.label}</p>
                  {!device.signedIn && <p className="text-xs text-muted">Signed out there: notifications still arrive, and answering asks for a sign-in.</p>}
                </div>
                <ForgetButton device={device} here={false} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
