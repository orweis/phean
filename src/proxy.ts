import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { routes } from "@/lib/routes";

/**
 * Optimistic redirect for signed-out visitors. It only checks that a session cookie exists;
 * every page and action still validates the session itself.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  return NextResponse.redirect(new URL(routes.signIn(next), request.url));
}

export const config = {
  matcher: ["/workspaces/:path*", "/w/:path*", "/invite/:path*"],
};
