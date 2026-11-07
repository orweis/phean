import { auth } from "@/server/auth/auth";

/** The fallback a client tries when the challenge gives it no path. */
export const GET = (request: Request) => auth.handler(request);
