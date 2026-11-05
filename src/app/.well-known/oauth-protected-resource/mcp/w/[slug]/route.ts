import { auth, workspaceResourceMetadata } from "@/server/auth/auth";
import { getDb } from "@/server/db/client";

const metadata = workspaceResourceMetadata(auth, getDb);

export async function GET(request: Request, { params }: RouteContext<"/.well-known/oauth-protected-resource/mcp/w/[slug]">) {
  return metadata(request, (await params).slug);
}
