import { auth, authServerMetadataRoute } from "@/server/auth/auth";

export const GET = authServerMetadataRoute(auth);
