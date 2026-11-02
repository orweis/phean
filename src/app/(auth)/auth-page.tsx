import { redirect } from "next/navigation";

import { AuthForm, type SocialProvider } from "@/components/auth-form";
import { queryParam, safeNextPath } from "@/lib/routes";
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

/** Shared by /sign-in and /sign-up: already signed-in visitors go straight to where they were headed. */
export async function AuthPage({ mode, searchParams }: AuthPageProps) {
  const next = safeNextPath(queryParam((await searchParams).next));
  if (await getSession()) redirect(next);

  const configured = oauthProviders();
  const providers = (Object.keys(configured) as SocialProvider[]).filter((provider) => configured[provider]);

  return (
    <>
      <h1 className="text-xl font-extrabold text-ink">{COPY[mode].title}</h1>
      <p className="mt-1 mb-6 text-sm text-ink-2">{COPY[mode].subtitle}</p>
      <AuthForm mode={mode} next={next} providers={providers} />
    </>
  );
}
