import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins/organization";

import { appUrl, oauthProviders, trustedOrigins } from "../config";
import { lazyDb } from "../db/client";
import * as authSchema from "../db/schema/auth";

const SEVEN_DAYS_IN_SECONDS = 60 * 60 * 24 * 7;

function socialProviders() {
  const { github, google } = oauthProviders();
  return {
    ...(github ? { github } : {}),
    ...(google ? { google } : {}),
  };
}

export const auth = betterAuth({
  appName: "Phean",
  baseURL: appUrl(),
  trustedOrigins: trustedOrigins(),
  database: drizzleAdapter(lazyDb, { provider: "pg", schema: authSchema }),
  emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
  socialProviders: socialProviders(),
  // Serverless instances do not share memory, so limits are counted in Postgres.
  rateLimit: { storage: "database" },
  plugins: [
    // Organizations are Phean tenants ("workspaces"). Invitations are shared as links,
    // so no email delivery is configured.
    organization({ creatorRole: "owner", invitationExpiresIn: SEVEN_DAYS_IN_SECONDS }),
    // Must be last: lets server actions set auth cookies.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
