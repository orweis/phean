import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser-side auth calls go through /api/auth so Better Auth's rate limits apply. */
export const authClient = createAuthClient({
  // A sign-in that needs a second factor answers `twoFactorRedirect`; the sign-in form goes on to the code page itself.
  plugins: [twoFactorClient()],
});
