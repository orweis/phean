import { getDb } from "@/server/db/client";
import { createPheanMcpHandler } from "@/server/mcp/handler";

const handler = createPheanMcpHandler({ getDb });

export const maxDuration = 60;

export { handler as DELETE, handler as GET, handler as POST };
