import type { Metadata } from "next";
import { cookies, headers } from "next/headers";

import { PushDeviceSettings } from "@/components/account/push-device-settings";
import { SignInMethods, type ProviderMethod } from "@/components/account/sign-in-methods";
import { TwoFactorSettings } from "@/components/account/two-factor-settings";
import { AnalyticsIdentity, ConsentLink } from "@/components/analytics";
import { AppHeader } from "@/components/app-header";
import { AppearancePicker } from "@/components/appearance-picker";
import { PageHeader } from "@/components/page-header";
import { PROVIDER_LABELS, type SocialProvider } from "@/components/provider-mark";
import { SkipLink } from "@/components/skip-link";
import { ThemePicker } from "@/components/theme-picker";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusRegion } from "@/components/ui/status-region";
import { callbackErrorMessage } from "@/lib/auth-errors";
import { roleCan } from "@/lib/permissions";
import { queryParam, routes } from "@/lib/routes";
import { auth } from "@/server/auth/auth";
import { analyticsConfig, analyticsIdentity, ANALYTICS_TEST_COOKIE } from "@/server/analytics";
import { getViewer } from "@/server/auth/session";
import { oauthProviders, vapidConfig } from "@/server/config";
import { listDevices } from "@/server/domain/notifications";
import { getAppearance, getTheme } from "@/server/web";
import { personCtx } from "@/server/entry";

export const metadata: Metadata = { title: "Account" };

const PROVIDERS = Object.keys(PROVIDER_LABELS) as SocialProvider[];

function isProvider(value: string | undefined): value is SocialProvider {
  return PROVIDERS.includes(value as SocialProvider);
}

/** The signed-in person's own account: how Phean looks for them, the ways they sign in, and two-factor. */
export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const viewer = await getViewer();
  const params = await searchParams;
  const accounts = await auth.api.listUserAccounts({ headers: await headers() });
  const method = (providerId: string) => {
    const account = accounts.find((candidate) => candidate.providerId === providerId);
    return { accountId: account?.id ?? null, connectedAt: account?.createdAt.toISOString() ?? null };
  };
  const configured = oauthProviders();
  const providers: ProviderMethod[] = PROVIDERS.map((id) => ({ id, ...method(id), available: Boolean(configured[id]) })).filter(
    (provider) => provider.available || provider.connectedAt,
  );
  const password = method("credential");
  const connected = queryParam(params.connected);
  const failed = callbackErrorMessage(queryParam(params.error));
  const twoFactorEnabled = Boolean((viewer.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled);
  const [appearance, theme, devices] = await Promise.all([getAppearance(), getTheme(), listDevices(personCtx(viewer.user))]);
  const analyticsOn = Boolean(analyticsConfig((await cookies()).get(ANALYTICS_TEST_COOKIE)?.value));
  const canSubscribe = viewer.memberships.some((membership) => roleCan(membership.role, "notify:subscribe"));

  return (
    <StatusRegion>
      <SkipLink />
      <AnalyticsIdentity {...analyticsIdentity(viewer)} />
      <AppHeader user={viewer.user} />
      <main id="content" tabIndex={-1} className="mx-auto max-w-3xl space-y-6 px-4 py-6 outline-none sm:px-6 sm:py-8">
        <PageHeader title="Account" description="How you sign in to Phean, and the second step that keeps it yours. Agents never use these: they connect with their own tokens." />
        {failed && (
          <p role="alert" className="rounded-md border border-late/30 bg-late-tint px-4 py-2.5 text-sm text-late-ink">
            {failed}
          </p>
        )}
        {!failed && isProvider(connected) && providers.some((provider) => provider.id === connected && provider.connectedAt) && (
          <p role="status" className="rounded-md border border-arrive/30 bg-arrive-tint px-4 py-2.5 text-sm text-arrive-ink">
            Connected {PROVIDER_LABELS[connected]}. You can sign in with it from now on.
          </p>
        )}
        <Card>
          <CardHeader title="Sign-in methods" description="Connect GitHub or Google to your account, or add a password, so any of them signs you in. Keep at least one; two means losing one never locks you out." />
          <CardBody>
            <SignInMethods email={viewer.user.email} password={password} providers={providers} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Two-factor authentication"
            description="A six-digit code from an authenticator app on your phone, asked for after your password, GitHub or Google. Backup codes get you in if you lose the phone."
          />
          <CardBody>
            <TwoFactorSettings enabled={twoFactorEnabled} hasPassword={Boolean(password.connectedAt)} />
          </CardBody>
        </Card>
        <Card id="notifications">
          <CardHeader
            title="Notifications on this device"
            description="A notification the moment an agent asks you to decide something, from every workspace you are a member of. Turn it on in each browser or app you use; mute a workspace from its Decisions page."
          />
          <CardBody>
            <PushDeviceSettings
              publicKey={vapidConfig()?.publicKey ?? null}
              canSubscribe={canSubscribe}
              devices={devices.map(({ id, label, endpoint, answerFromNotification, private: isPrivate, signedIn }) => ({ id, label, endpoint, answerFromNotification, private: isPrivate, signedIn }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Appearance" description="A colour theme, and Light, Dark or System, which follows your device. Both apply at once and stay with this browser." />
          <CardBody className="space-y-5">
            <ThemePicker initial={theme} size="lg" />
            <AppearancePicker initial={appearance} className="sm:max-w-sm" />
          </CardBody>
        </Card>
        {analyticsOn && (
          <Card id="analytics">
            <CardHeader
              title="Analytics"
              description="Whether this browser sends Google Analytics anonymous usage: which pages and features are used, never names, titles or what you write."
            />
            <CardBody className="flex flex-wrap items-center gap-3 text-sm">
              <ConsentLink className={buttonClasses("secondary", "md")}>Change analytics choice</ConsentLink>
              <a href={routes.privacy()} className="link">
                What is sent
              </a>
            </CardBody>
          </Card>
        )}
      </main>
    </StatusRegion>
  );
}
