"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { routes } from "@/lib/routes";
import { normalizeCode, TRUST_DEVICE_DAYS } from "@/lib/two-factor";

import { Button } from "./ui/button";
import { Field, Input } from "./ui/field";

/** An authenticator code, or one of the backup codes saved when two-factor was turned on. */
export function TwoFactorForm({ next }: { next: string }) {
  const router = useRouter();
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = normalizeCode(String(form.get("code")));
    const trustDevice = form.get("trustDevice") === "on";
    setError(null);
    startTransition(async () => {
      const { error: failure } = backup
        ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
        : await authClient.twoFactor.verifyTotp({ code, trustDevice });
      if (failure) {
        setExpired(failure.code === "INVALID_TWO_FACTOR_COOKIE" || failure.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE");
        setError(authErrorMessage(failure));
        return;
      }
      router.push(next);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="space-y-4">
        {backup ? (
          <Field label="Backup code" htmlFor="code" hint="One of the codes you saved when you turned on two-factor. Each works once.">
            <Input key="backup" id="code" name="code" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={40} autoFocus />
          </Field>
        ) : (
          <Field label="Authentication code" htmlFor="code" hint="Six digits from your authenticator app.">
            <Input key="totp" id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" name="trustDevice" className="size-4 accent-accent" />
          Trust this browser for {TRUST_DEVICE_DAYS} days
        </label>
        {error && (
          <p role="alert" className="rounded-md border border-late/30 bg-late-tint px-3 py-2 text-sm text-late-ink">
            {error}{" "}
            {expired && (
              <Link href={routes.signIn(next)} className="link">
                Sign in again
              </Link>
            )}
          </p>
        )}
        <Button type="submit" variant="primary" className="w-full" pending={pending}>
          Verify
        </Button>
      </form>
      <p className="text-center text-sm text-muted">
        <button
          type="button"
          className="link"
          onClick={() => {
            setBackup((current) => !current);
            setError(null);
          }}
        >
          {backup ? "Use your authenticator app" : "Use a backup code instead"}
        </button>
      </p>
    </div>
  );
}
