"use server";

import { isAPIError } from "better-auth/api";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { authErrorMessage } from "@/lib/auth-errors";
import { LIMITS } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { auth } from "@/server/auth/auth";

export type SetPasswordResult = { ok: true } | { ok: false; message: string };

/**
 * Adds a password for someone who signs in with GitHub or Google only. Better Auth keeps this
 * endpoint server-side (a session alone sets it), and refuses it once a password exists.
 */
export async function setPasswordAction(newPassword: string): Promise<SetPasswordResult> {
  if (newPassword.length < LIMITS.passwordMin || newPassword.length > LIMITS.passwordMax) {
    return { ok: false, message: `Use ${LIMITS.passwordMin} to ${LIMITS.passwordMax} characters.` };
  }
  try {
    await auth.api.setPassword({ body: { newPassword }, headers: await headers() });
  } catch (error) {
    if (isAPIError(error)) return { ok: false, message: authErrorMessage({ code: error.body?.code, status: error.statusCode }) };
    throw error;
  }
  revalidatePath(routes.account());
  return { ok: true };
}
