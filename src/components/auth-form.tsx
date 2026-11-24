"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";

import { track } from "@/lib/analytics";
import { takeSignals } from "@/lib/analytics-signals";
import { authClient } from "@/lib/auth-client";
import { LIMITS } from "@/lib/domain";
import { routes } from "@/lib/routes";

import { PROVIDER_LABELS, ProviderMark, type SocialProvider } from "./provider-mark";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/field";
import { useDesktopShell } from "./use-desktop-shell";

interface AuthFormProps {
  mode: "sign-in" | "sign-up";
  next: string;
  providers: readonly SocialProvider[];
  /** Why a sign-in with a provider came back without a session, in words. */
  initialError?: string | null;
}

export type { SocialProvider };

export function AuthForm({ mode, next, providers, initialError = null }: AuthFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError);
  const [pending, startTransition] = useTransition();
  const signingUp = mode === "sign-up";
  // In the desktop app a provider's page never loads in the window: the system browser signs in, then the app reloads.
  const desktop = useDesktopShell();

  // A tick later, so on a fresh load the analytics loader (an ancestor) has applied consent.
  useEffect(() => {
    if (!signingUp) return;
    const timer = window.setTimeout(() => track("sign_up_start"), 0);
    return () => window.clearTimeout(timer);
  }, [signingUp]);

  const continueWith = (provider: SocialProvider) =>
    startTransition(async () => {
      setError(null);
      if (desktop) {
        try {
          await desktop.signInWithBrowser(provider);
        } catch {
          setError(`Signing in with ${PROVIDER_LABELS[provider]} in your browser did not finish. Try again, or use your email.`);
        }
        return;
      }
      // On success the browser leaves for the provider; a failure stays here and says why.
      const { error: failure } = await authClient.signIn.social({ provider, callbackURL: next, errorCallbackURL: `${mode === "sign-up" ? routes.signUp(next) : routes.signIn(next)}` });
      if (failure) setError(failure.message ?? `Could not reach ${PROVIDER_LABELS[provider]}. Try again, or use your email.`);
    });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setError(null);
    startTransition(async () => {
      const { data, error: failure } = signingUp
        ? await authClient.signUp.email({ name: String(form.get("name")), email, password })
        : await authClient.signIn.email({ email, password });
      if (failure) {
        setError(failure.message ?? "Something went wrong. Please try again.");
        return;
      }
      // Two-factor is on: the password was right, and the code comes next (and sends the `login`).
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        // A provider's unfinished sign-in may have left its method waiting; this one is a password.
        takeSignals();
        router.push(routes.twoFactor(next));
        return;
      }
      // GitHub and Google sign-ups and sign-ins reach the next page as signals (`server/auth/analytics.ts`).
      if (signingUp) track("sign_up", { method: "password" });
      else track("login", { method: "password", two_factor: false });
      router.push(next);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {providers.length > 0 && (
        <>
          <div className="grid gap-2">
            {providers.map((provider) => (
              <Button
                key={provider}
                className="w-full"
                disabled={pending}
                onClick={() => continueWith(provider)}
              >
                <ProviderMark provider={provider} />
                Continue with {PROVIDER_LABELS[provider]}
                {desktop && " in your browser"}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-rule" />
            or
            <span className="h-px flex-1 bg-rule" />
          </div>
        </>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        {signingUp && (
          <Field label="Name" htmlFor="name">
            <Input id="name" name="name" autoComplete="name" required maxLength={LIMITS.name} />
          </Field>
        )}
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password" hint={signingUp ? `At least ${LIMITS.passwordMin} characters.` : undefined}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={signingUp ? "new-password" : "current-password"}
            minLength={LIMITS.passwordMin}
            maxLength={LIMITS.passwordMax}
            required
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-md border border-late/30 bg-late-tint px-3 py-2 text-sm text-late-ink">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="w-full" pending={pending}>
          {signingUp ? "Create account" : "Sign in"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted">
        {signingUp ? "Already have an account? " : "New to Phean? "}
        <Link
          href={signingUp ? routes.signIn(next) : routes.signUp(next)}
          className="font-semibold text-ink underline decoration-rule underline-offset-2 hover:decoration-ink active:decoration-2"
        >
          {signingUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
}
