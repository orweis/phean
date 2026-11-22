import { workspaceMcpMetadata } from "@/server/entry";

const metadata = workspaceMcpMetadata();

export async function GET(request: Request, { params }: RouteContext<"/.well-known/oauth-protected-resource/mcp/w/[slug]">) {
  return metadata(request, (await params).slug);
}
