"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { LIMITS } from "@/lib/domain";
import { routes } from "@/lib/routes";

import { Button } from "./ui/button";
import { Field, Input } from "./ui/field";

export type SocialProvider = "github" | "google";
const PROVIDER_LABELS: Record<SocialProvider, string> = { github: "GitHub", google: "Google" };

/** Each provider's mark, in one colour (the button's ink), so it sits in either appearance. */
function ProviderMark({ provider }: { provider: SocialProvider }) {
  return provider === "github" ? (
    <svg viewBox="0 0 16 16" aria-hidden className="size-4 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-current">
      <path d="M21.35 11.1H12v2.98h5.35c-.23 1.45-1.67 4.25-5.35 4.25-3.22 0-5.85-2.67-5.85-5.96S8.78 6.41 12 6.41c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.68 3.85 14.55 2.9 12 2.9 6.97 2.9 2.9 6.97 2.9 12s4.07 9.1 9.1 9.1c5.25 0 8.73-3.69 8.73-8.89 0-.6-.07-1.05-.15-1.51Z" />
    </svg>
  );
}

interface AuthFormProps {
  mode: "sign-in" | "sign-up";
  next: string;
  providers: readonly SocialProvider[];
  /** Why a sign-in with a provider came back without a session, in words. */
  initialError?: string | null;
}

export function AuthForm({ mode, next, providers, initialError = null }: AuthFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError);
  const [pending, startTransition] = useTransition();
  const signingUp = mode === "sign-up";

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setError(null);
    startTransition(async () => {
      const { error: failure } = signingUp
        ? await authClient.signUp.email({ name: String(form.get("name")), email, password })
        : await authClient.signIn.email({ email, password });
      if (failure) {
        setError(failure.message ?? "Something went wrong. Please try again.");
        return;
      }
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
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    // On success the browser leaves for the provider; a failure stays here and says why.
                    const { error: failure } = await authClient.signIn.social({ provider, callbackURL: next, errorCallbackURL: `${mode === "sign-up" ? routes.signUp(next) : routes.signIn(next)}` });
                    if (failure) setError(failure.message ?? `Could not reach ${PROVIDER_LABELS[provider]}. Try again, or use your email.`);
                  })
                }
              >
                <ProviderMark provider={provider} />
                Continue with {PROVIDER_LABELS[provider]}
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
        <Field label="Password" htmlFor="password" hint={signingUp ? "At least 8 characters." : undefined}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={signingUp ? "new-password" : "current-password"}
            minLength={8}
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
