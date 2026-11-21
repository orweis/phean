"use server";

import { isAPIError } from "better-auth/api";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { authErrorMessage } from "@/lib/auth-errors";
import { LIMITS } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { attempt, personAction } from "@/server/actions";
import { auth } from "@/server/auth/auth";
import { getSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { personContext } from "@/server/domain/context";
import { forgetDevice, registerDevice, setDeviceOptions } from "@/server/domain/notifications";

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

export type RegisterDeviceResult = { ok: true; deviceId: string; label: string } | { ok: false; message: string };

/**
 * Turns on Decision notifications for the browser's push subscription. The session it is tied to
 * is the one this request arrived on, never anything the browser posted.
 */
export async function registerDeviceAction(input: unknown): Promise<RegisterDeviceResult> {
  const signedIn = await getSession();
  if (!signedIn) return { ok: false, message: "Sign in again to turn on notifications." };
  const result = await attempt(() =>
    registerDevice(personContext(getDb(), signedIn.user), input as Parameters<typeof registerDevice>[1], { sessionId: signedIn.session.id }),
  );
  if (!result.ok) return { ok: false, message: result.state.message ?? "Could not turn on notifications." };
  revalidatePath(routes.account());
  return { ok: true, deviceId: result.value.id, label: result.value.label };
}

export const forgetDeviceAction = personAction(forgetDevice);
export const setDeviceOptionsAction = personAction(setDeviceOptions);
