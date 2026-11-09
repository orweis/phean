import { toNextJsHandler } from "better-auth/next-js";

import { auth, authRouteHandler } from "@/server/auth/auth";

export const { GET, POST } = toNextJsHandler(authRouteHandler(auth));
