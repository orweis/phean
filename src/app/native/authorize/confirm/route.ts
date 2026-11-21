import { auth } from "@/server/auth/auth";
import { nativeConfirmRoute } from "@/server/auth/native";
import { appUrl } from "@/server/config";

/** The confirm form on /native/authorize. It answers 303 to the desktop app's loopback address. */
export function POST(request: Request): Promise<Response> {
  return nativeConfirmRoute(auth, appUrl())(request);
}
