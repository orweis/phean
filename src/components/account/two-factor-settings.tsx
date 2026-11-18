"use client";

import { Download, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { LIMITS } from "@/lib/domain";
import { groupSecret, normalizeCode, totpSecretOf } from "@/lib/two-factor";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
import { Field, Input } from "../ui/field";
import { Popover, PopoverCancel, usePopover } from "../ui/popover";
import { useStatus } from "../ui/status-region";
import { QrCode } from "./qr-code";

interface TwoFactorSettingsProps {
  enabled: boolean;
  /** A person with a password confirms it before changing two-factor; one who signs in with a provider only has none. */
  hasPassword: boolean;
}

type Setup = { step: "idle" } | { step: "scan"; uri: string; backupCodes: string[] } | { step: "save"; backupCodes: string[] };

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-late/30 bg-late-tint px-3 py-2 text-sm text-late-ink">
      {message}
    </p>
  );
}

function PasswordField({ id }: { id: string }) {
  return (
    <Field label="Your password" htmlFor={id}>
      <Input id={id} name="password" type="password" autoComplete="current-password" required maxLength={LIMITS.passwordMax} />
    </Field>
  );
}

/** The codes, once: to copy, download, or write down. Each signs in once when the authenticator is lost. */
function BackupCodes({ codes }: { codes: readonly string[] }) {
  const text = codes.join("\n");
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Phean backup codes\nEach code signs in once.\n\n${text}\n`], { type: "text/plain" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "phean-backup-codes.txt" });
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3">
      <ol aria-label="Backup codes" className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md bg-fill px-4 py-3 font-mono text-sm text-ink tabular-nums">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={text} label="Copy codes" subject="backup codes" />
        <Button size="sm" onClick={download}>
          <Download aria-hidden />
          Download
        </Button>
      </div>
    </div>
  );
}

/** A new set of backup codes, which retires the old ones. */
function RegenerateCodes({ hasPassword }: { hasPassword: boolean }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = hasPassword ? String(new FormData(event.currentTarget).get("password")) : undefined;
    setError(null);
    startTransition(async () => {
      const { data, error: failure } = await authClient.twoFactor.generateBackupCodes(password ? { password } : {});
      if (failure || !data) return setError(authErrorMessage(failure));
      setCodes(data.backupCodes);
    });
  }

  if (codes) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-2">Your old codes no longer work. Save these somewhere safe; Phean will not show them again.</p>
        <BackupCodes codes={codes} />
        <div className="flex justify-end">
          <PopoverCancel>Done</PopoverCancel>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm text-ink-2">New codes replace the ones you saved before.</p>
      {hasPassword && <PasswordField id="codes-password" />}
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <PopoverCancel />
        <Button type="submit" variant="primary" size="sm" pending={pending}>
          Get new codes
        </Button>
      </div>
    </form>
  );
}

function TurnOff({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const status = useStatus();
  const popover = usePopover();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = hasPassword ? String(new FormData(event.currentTarget).get("password")) : undefined;
    if (!window.confirm("Turn off two-factor? Signing in will need only your password, GitHub or Google.")) return;
    setError(null);
    startTransition(async () => {
      const { error: failure } = await authClient.twoFactor.disable(password ? { password } : {});
      if (failure) return setError(authErrorMessage(failure));
      popover?.close();
      status?.announce({ message: "Turned off two-factor" });
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm text-ink-2">Your authenticator app and backup codes will stop working for Phean.</p>
      {hasPassword && <PasswordField id="off-password" />}
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <PopoverCancel />
        <Button type="submit" variant="danger" size="sm" pending={pending}>
          Turn off
        </Button>
      </div>
    </form>
  );
}

/**
 * Two-factor with an authenticator app. Turning it on is three steps in place: confirm the
 * password, scan the code and enter what the app shows, then save the backup codes. Once on, every
 * sign-in asks for a code, whether it starts with a password, GitHub or Google.
 */
export function TwoFactorSettings({ enabled, hasPassword }: TwoFactorSettingsProps) {
  const router = useRouter();
  const status = useStatus();
  const [setup, setSetup] = useState<Setup>({ step: "idle" });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const begin = (password?: string) => {
    setError(null);
    startTransition(async () => {
      const { data, error: failure } = await authClient.twoFactor.enable(password ? { password } : {});
      if (failure || !data || !("totpURI" in data)) return setError(authErrorMessage(failure));
      setStarting(false);
      setSetup({ step: "scan", uri: data.totpURI, backupCodes: data.backupCodes });
    });
  };

  const verify = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (setup.step !== "scan") return;
    const code = normalizeCode(String(new FormData(event.currentTarget).get("code")));
    setError(null);
    startTransition(async () => {
      const { error: failure } = await authClient.twoFactor.verifyTotp({ code });
      if (failure) return setError(authErrorMessage(failure));
      setSetup({ step: "save", backupCodes: setup.backupCodes });
    });
  };

  const cancel = () => {
    setSetup({ step: "idle" });
    setStarting(false);
    setError(null);
  };

  if (setup.step === "scan") {
    const secret = totpSecretOf(setup.uri);
    return (
      <div className="space-y-4">
        <p className="text-sm font-semibold text-ink">1. Scan this code with your authenticator app</p>
        <div className="flex flex-wrap items-start gap-5">
          <QrCode value={setup.uri} label="QR code to add Phean to your authenticator app" />
          <div className="min-w-0 flex-1 basis-56 space-y-2 text-sm text-ink-2">
            <p>1Password, Google Authenticator, Authy, Microsoft Authenticator and the iPhone&rsquo;s Passwords app all work.</p>
            {secret && (
              <>
                <p>Can&rsquo;t scan it? Enter this key instead:</p>
                <p className="flex flex-wrap items-center gap-2">
                  <code data-secret className="rounded-xs bg-fill px-2 py-1 font-mono text-sm break-all text-ink">
                    {groupSecret(secret)}
                  </code>
                  <CopyButton value={secret} subject="setup key" variant="ghost" />
                </p>
              </>
            )}
          </div>
        </div>
        <form onSubmit={verify} className="space-y-3">
          <p className="text-sm font-semibold text-ink">2. Enter the code the app shows</p>
          <div className="w-48">
            <Field label="Authentication code" htmlFor="setup-code">
              <Input id="setup-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required />
            </Field>
          </div>
          <FormError message={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="sm" pending={pending}>
              Verify and turn on
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    );
  }

  if (setup.step === "save") {
    return (
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ShieldCheck className="size-4 text-arrive-ink" aria-hidden />
          Two-factor is on. Save your backup codes.
        </p>
        <p className="text-sm text-ink-2">If you lose your phone, each of these signs you in once. Phean will not show them again.</p>
        <BackupCodes codes={setup.backupCodes} />
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setSetup({ step: "idle" });
            status?.announce({ message: "Turned on two-factor" });
            router.refresh();
          }}
        >
          I&rsquo;ve saved them
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm text-ink-2">
          {enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
          {enabled ? "Every sign-in asks for a code from your authenticator app." : "Ask for a code from an authenticator app each time you sign in."}
        </p>
        {enabled ? (
          <div className="flex items-center gap-1">
            <Popover label="New backup codes" title="New backup codes">
              <RegenerateCodes hasPassword={hasPassword} />
            </Popover>
            <Popover label="Turn off" title="Turn off two-factor" variant="ghost">
              <TurnOff hasPassword={hasPassword} />
            </Popover>
          </div>
        ) : (
          !starting && (
            <Button variant="primary" size="sm" pending={pending} onClick={() => (hasPassword ? setStarting(true) : begin())}>
              Turn on
            </Button>
          )
        )}
      </div>
      {starting && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            begin(String(new FormData(event.currentTarget).get("password")));
          }}
          className="max-w-sm space-y-3"
        >
          <PasswordField id="on-password" />
          <FormError message={error} />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" pending={pending}>
              Continue
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {!starting && <FormError message={error} />}
    </div>
  );
}
