"use client";

import { Ellipsis, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";

import { setPasswordAction } from "@/app/account/actions";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { LIMITS } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";

import { PROVIDER_LABELS, ProviderMark, type SocialProvider } from "../provider-mark";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { Popover, PopoverCancel, usePopover } from "../ui/popover";
import { useStatus } from "../ui/status-region";
import { useDesktopShell } from "../use-desktop-shell";

export interface ProviderMethod {
  id: SocialProvider;
  /** The connection's own id, which removing it names; null when it is not connected. */
  accountId: string | null;
  /** When it was connected, or null when it is not. */
  connectedAt: string | null;
  /** Whether this deployment can sign in with it; one connected before it was switched off can still be removed. */
  available: boolean;
}

interface SignInMethodsProps {
  email: string;
  password: { accountId: string | null; connectedAt: string | null };
  providers: readonly ProviderMethod[];
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-late/30 bg-late-tint px-3 py-2 text-sm text-late-ink">
      {message}
    </p>
  );
}

/** Says what happened in the page's status region, then shows the page as it now is. */
function useReport() {
  const router = useRouter();
  const status = useStatus();
  return (message: string, tone: "plain" | "error" = "plain") => {
    status?.announce({ message, tone });
    if (tone === "plain") router.refresh();
  };
}

function ChangePasswordForm() {
  const popover = usePopover();
  const report = useReport();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const { error: failure } = await authClient.changePassword({
        currentPassword: String(form.get("currentPassword")),
        newPassword: String(form.get("newPassword")),
        revokeOtherSessions: form.get("revokeOtherSessions") === "on",
      });
      if (failure) return setError(authErrorMessage(failure));
      popover?.close();
      report("Changed your password");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Current password" htmlFor="current-password">
        <Input id="current-password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={LIMITS.passwordMax} />
      </Field>
      <Field label="New password" htmlFor="new-password" hint={`At least ${LIMITS.passwordMin} characters.`}>
        <Input id="new-password" name="newPassword" type="password" autoComplete="new-password" required minLength={LIMITS.passwordMin} maxLength={LIMITS.passwordMax} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" name="revokeOtherSessions" defaultChecked className="size-4 accent-accent" />
        Sign out everywhere else
      </label>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <PopoverCancel />
        <Button type="submit" variant="primary" size="sm" pending={pending}>
          Change password
        </Button>
      </div>
    </form>
  );
}

function SetPasswordForm({ email }: { email: string }) {
  const popover = usePopover();
  const report = useReport();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newPassword = String(new FormData(event.currentTarget).get("newPassword"));
    setError(null);
    startTransition(async () => {
      const result = await setPasswordAction(newPassword);
      if (!result.ok) return setError(result.message);
      popover?.close();
      report(`Set a password: you can sign in as ${email} too`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm text-ink-2">
        Then you can sign in with <span className="font-semibold text-ink">{email}</span> and this password as well.
      </p>
      {/* A hidden username lets password managers save the pair. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <Field label="New password" htmlFor="set-password" hint={`At least ${LIMITS.passwordMin} characters.`}>
        <Input id="set-password" name="newPassword" type="password" autoComplete="new-password" required minLength={LIMITS.passwordMin} maxLength={LIMITS.passwordMax} />
      </Field>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <PopoverCancel />
        <Button type="submit" variant="primary" size="sm" pending={pending}>
          Set password
        </Button>
      </div>
    </form>
  );
}

/** One sign-in method: its mark, its name and state, and what can be done with it. */
function MethodRow({ icon, name, detail, connected, children }: { icon: ReactNode; name: string; detail: string; connected: boolean; children: ReactNode }) {
  return (
    <li data-method={name} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-fill text-ink [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
          {name}
          {connected ? <Badge tone="success">Connected</Badge> : <Badge>Not connected</Badge>}
        </p>
        <p className="truncate text-xs text-muted">{detail}</p>
      </div>
      <div className="flex items-center gap-1">{children}</div>
    </li>
  );
}

/**
 * The ways a person signs in: a password, GitHub, Google. They connect a provider while signed in
 * (which also works when its address differs from theirs), add or change a password, and remove
 * any method but the last.
 */
export function SignInMethods({ email, password, providers }: SignInMethodsProps) {
  const report = useReport();
  const [pending, startTransition] = useTransition();
  const connectedCount = (password.connectedAt ? 1 : 0) + providers.filter((provider) => provider.connectedAt).length;
  const onlyOne = connectedCount <= 1;

  // The desktop app never shows a provider's page, so connecting one happens on this page in the system browser.
  const desktop = useDesktopShell();

  const connect = (provider: SocialProvider) =>
    startTransition(async () => {
      if (desktop) {
        try {
          await desktop.openInBrowser(routes.account());
          report(`Opened your account in your browser: connect ${PROVIDER_LABELS[provider]} there`);
        } catch {
          report(`Could not open your browser. Connect ${PROVIDER_LABELS[provider]} from ${routes.account()} in a browser.`, "error");
        }
        return;
      }
      // On success the browser leaves for the provider and comes back to this page.
      const { error } = await authClient.linkSocial({ provider, callbackURL: `${routes.account()}?connected=${provider}`, errorCallbackURL: routes.account() });
      if (error) report(authErrorMessage(error, `Could not reach ${PROVIDER_LABELS[provider]}. Try again.`), "error");
    });

  const remove = (accountId: string | null, done: string, question: string) => {
    if (!accountId || !window.confirm(question)) return;
    startTransition(async () => {
      const { error } = await authClient.unlinkAccount({ accountId });
      report(error ? authErrorMessage(error) : done, error ? "error" : "plain");
    });
  };

  const otherWays = (except: string) =>
    [password.connectedAt && except !== "credential" ? "your password" : null, ...providers.filter((provider) => provider.connectedAt && provider.id !== except).map((provider) => PROVIDER_LABELS[provider.id])]
      .filter(Boolean)
      .join(" or ");

  return (
    <ul aria-label="Sign-in methods" className="divide-y divide-rule">
      <MethodRow
        icon={<KeyRound />}
        name="Password"
        detail={password.connectedAt ? `${email} · set ${timeAgo(new Date(password.connectedAt))}` : `Add one to sign in with ${email} and a password`}
        connected={Boolean(password.connectedAt)}
      >
        {password.connectedAt ? (
          <>
            <Popover label="Change password" title="Change your password">
              <ChangePasswordForm />
            </Popover>
            <Popover menu variant="ghost" triggerLabel="More actions for your password" label={<Ellipsis aria-hidden />} triggerClassName="px-2">
              <Button
                size="menu"
                variant="ghost"
                disabled={onlyOne || pending}
                title={onlyOne ? "Your only way to sign in" : undefined}
                onClick={() => remove(password.accountId, "Removed your password", `Remove your password? You will sign in with ${otherWays("credential")} only.`)}
              >
                Remove password
              </Button>
            </Popover>
          </>
        ) : (
          <Popover label="Set a password" title="Set a password" variant="tinted">
            <SetPasswordForm email={email} />
          </Popover>
        )}
      </MethodRow>
      {providers.map((provider) => {
        const name = PROVIDER_LABELS[provider.id];
        return (
          <MethodRow
            key={provider.id}
            icon={<ProviderMark provider={provider.id} />}
            name={name}
            detail={provider.connectedAt ? `Connected ${timeAgo(new Date(provider.connectedAt))}` : `Sign in with your ${name} account`}
            connected={Boolean(provider.connectedAt)}
          >
            {provider.connectedAt ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={onlyOne || pending}
                title={onlyOne ? "Your only way to sign in" : undefined}
                aria-label={`Disconnect ${name}`}
                onClick={() => remove(provider.accountId, `Disconnected ${name}`, `Disconnect ${name}? You will sign in with ${otherWays(provider.id)}.`)}
              >
                Disconnect
              </Button>
            ) : (
              provider.available && (
                <Button size="sm" variant="tinted" disabled={pending} aria-label={desktop ? `Connect ${name} in your browser` : `Connect ${name}`} onClick={() => connect(provider.id)}>
                  Connect
                </Button>
              )
            )}
          </MethodRow>
        );
      })}
    </ul>
  );
}
