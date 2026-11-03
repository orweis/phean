import { getDb } from "@/server/db/client";
import { createPheanMcpHandler } from "@/server/mcp/handler";

const handler = createPheanMcpHandler({ getDb });

/** Long enough for wait_for_answers (at most MAX_WAIT_SECONDS) to hold a request open. */
export const maxDuration = 300;

export { handler as DELETE, handler as GET, handler as POST };
