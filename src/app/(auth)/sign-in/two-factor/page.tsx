import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TwoFactorForm } from "@/components/two-factor-form";
import { queryParam, safeNextPath } from "@/lib/routes";
import { getSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Two-factor sign-in" };

/** The second step of a sign-in: the first factor (a password, GitHub or Google) left a pending challenge cookie. */
export default async function TwoFactorPage({ searchParams }: PageProps<"/sign-in/two-factor">) {
  const next = safeNextPath(queryParam((await searchParams).next));
  if (await getSession()) redirect(next);
  return (
    <>
      <h1 className="text-xl font-bold text-ink">Enter your code</h1>
      <p className="mt-1 mb-6 text-sm text-ink-2">Two-factor is on for this account. Open your authenticator app and enter the code it shows for Phean.</p>
      <TwoFactorForm next={next} />
    </>
  );
}
