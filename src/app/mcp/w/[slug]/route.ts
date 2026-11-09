import { getDb } from "@/server/db/client";
import { createPheanMcpHandler } from "@/server/mcp/handler";

/**
 * A workspace's own MCP URL, for clients that keep one login per URL. The handler reads the slug from
 * the path and refuses any credential whose agent works elsewhere.
 */
const handler = createPheanMcpHandler({ getDb });

/** Long enough for wait_for_answers (at most MAX_WAIT_SECONDS) to hold a request open. */
export const maxDuration = 300;

export { handler as DELETE, handler as GET, handler as POST };
