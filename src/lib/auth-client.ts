import { createAuthClient } from "better-auth/react";

/** Browser-side auth calls go through /api/auth so Better Auth's rate limits apply. */
export const authClient = createAuthClient();
