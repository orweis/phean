import { redirect } from "next/navigation";

import { AuthForm, type SocialProvider } from "@/components/auth-form";
import { authorizeRetryPath } from "@/lib/oauth-consent";
import { queryParam, queryStringOf, safeNextPath } from "@/lib/routes";
import { getSession } from "@/server/auth/session";
import { oauthProviders } from "@/server/config";

interface AuthPageProps {
  mode: "sign-in" | "sign-up";
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const COPY = {
  "sign-in": { title: "Welcome back", subtitle: "Sign in to see what your agents have been up to." },
  "sign-up": { title: "Create your account", subtitle: "Then create a workspace and connect your first agent." },
};

/** What the `error` a provider sign-in came back with means, for the person; never the raw code alone. */
function socialError(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "access_denied") return "Sign-in was cancelled at the provider. Try again, or use your email.";
  if (code === "account_not_linked") return "That email already has a Phean account. Sign in with your password first.";
  return "Sign-in with that provider did not complete. Try again, or use your email.";
}

/** Shared by /sign-in and /sign-up: already signed-in visitors go straight to where they were headed. */
export async function AuthPage({ mode, searchParams }: AuthPageProps) {
  const params = await searchParams;
  // The OAuth provider sends people here with its signed query and no `next`: signing in runs authorize again, which checks it all.
  const next = params.sig ? authorizeRetryPath(queryStringOf(params)) : safeNextPath(queryParam(params.next));
  if (await getSession()) redirect(next);

  const configured = oauthProviders();
  const providers = (Object.keys(configured) as SocialProvider[]).filter((provider) => configured[provider]);

  return (
    <>
      <h1 className="text-xl font-bold text-ink">{COPY[mode].title}</h1>
      <p className="mt-1 mb-6 text-sm text-ink-2">{COPY[mode].subtitle}</p>
      <AuthForm mode={mode} next={next} providers={providers} initialError={socialError(queryParam(params.error))} />
    </>
  );
}
