import { appUrl } from "../config";
import { lazyDb } from "../db/client";
import { createAuth } from "./auth";

/** For the `auth` CLI (`pnpm auth:schema`), which can't read the lazy Proxy that `auth.ts` exports. */
export const auth = createAuth(lazyDb, appUrl());
