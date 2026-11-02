"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { routes } from "@/lib/routes";

import { Button } from "./ui/button";
import { Field, Input } from "./ui/field";

export type SocialProvider = "github" | "google";
const PROVIDER_LABELS: Record<SocialProvider, string> = { github: "GitHub", google: "Google" };

interface AuthFormProps {
  mode: "sign-in" | "sign-up";
  next: string;
  providers: readonly SocialProvider[];
}

export function AuthForm({ mode, next, providers }: AuthFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
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
                onClick={() => startTransition(async () => void (await authClient.signIn.social({ provider, callbackURL: next })))}
              >
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
            <Input id="name" name="name" autoComplete="name" required maxLength={80} />
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
        <Button type="submit" variant="primary" className="w-full" disabled={pending}>
          {pending && <LoaderCircle className="motion-safe:animate-spin" aria-hidden />}
          {signingUp ? "Create account" : "Sign in"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted">
        {signingUp ? "Already have an account? " : "New to Phean? "}
        <Link
          href={signingUp ? routes.signIn(next) : routes.signUp(next)}
          className="font-semibold text-ink underline decoration-rule hover:decoration-ink"
        >
          {signingUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
}
