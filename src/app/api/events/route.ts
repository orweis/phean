import { handleEventStream } from "@/server/realtime/endpoint";

export const dynamic = "force-dynamic";
// Each stream ends itself (STREAM_LIMITS.lifetimeMs) before this, asking the agent to reconnect.
export const maxDuration = 300;

/** The realtime event stream for agents: see `handleEventStream`. */
export const GET = handleEventStream;
