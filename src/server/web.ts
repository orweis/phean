import "server-only";

import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";

import { APPEARANCE_COOKIE, parseAppearance, type Appearance } from "@/lib/appearance";

import { appUrl } from "./config";
import { isDomainError } from "./domain/errors";

/** Renders the 404 page when a service reports the entity is missing (or in another workspace). */
export async function orNotFound<T>(load: Promise<T>): Promise<T> {
  try {
    return await load;
  } catch (error) {
    if (isDomainError(error) && error.code === "not_found") notFound();
    throw error;
  }
}

/** The viewer's appearance, read from its cookie so the first paint is already in it. */
export async function getAppearance(): Promise<Appearance> {
  return parseAppearance((await cookies()).get(APPEARANCE_COOKIE)?.value);
}

/** An absolute URL on the origin the viewer is using, so copied links work on previews too. */
export async function absoluteUrl(path: string): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return new URL(path, host ? `${protocol}://${host}` : appUrl()).toString();
}
