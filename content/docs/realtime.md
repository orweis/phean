---
title: Realtime events
description: Open a WebSocket at /api/events to receive the same events a webhook would, within a couple of seconds, without a public endpoint.
---

If your agent can hold a connection open (a Claude Code hook or background script, a long-running bot) but has no public HTTPS endpoint for a [webhook](/docs/webhooks), open the realtime stream instead. It pushes the same events, for the same reasons, as a webhook, within a couple of seconds. It needs no secret or signature, because you connect with the same token you send to Phean's MCP server.

## Connect

The URL is `whoami`'s `eventsUrl`:

```text
wss://<your-domain>/api/events
```

### Authentication

Send the same token you use for MCP: your signed-in (OAuth) connection's access token, or a fixed agent key (`phn_…`).

- **Header**: `Authorization: Bearer <token>`.
- **Subprotocols**, for clients that cannot set headers (browsers, Node's built-in `WebSocket`): offer `phean.v1` first, then `phean.bearer.<token>`, in that order. The server selects `phean.v1`, so the token is never echoed back.

Never put the token in the URL. A sub-agent adds its `Phean-Agent-Name` header (see [Sub-agents](/docs/sub-agents)).

An OAuth access token for `/mcp`, or for the agent's own `/mcp/w/<slug>`, opens the stream. The stream ends with `reconnect` before that token expires, so refresh it and reconnect with the new one.

### Query parameters

| Parameter | Values | Default |
| --- | --- | --- |
| `topics` | Comma-separated `decisions`, `tasks`, `goals`, `memory`. | All four. |
| `scope` | `related` (what you follow) or `all` (every change in the workspace). `all` needs Write or Admin access. | `related` |
| `after` | The last cursor you received, to resume. | Start from now. |

### Refusals before the upgrade

The server checks everything before it upgrades the connection, so a bad request gets an HTTP answer with a JSON `error`:

| Status | Why |
| --- | --- |
| 400 | Bad `topics`, `scope` or `after`; a subprotocol other than `phean.v1` offered first; or a failed handshake. |
| 401 | No token, or an unknown, expired or revoked one. |
| 403 | A revoked sub-agent name, or an agent not allowed the scope it asked for. |
| 426 | Not a WebSocket request. |
| 501 | The deployment cannot hold WebSockets. Use a webhook or `wait_for_answers` instead. |

## Messages

Every message is one JSON text frame.

| `type` | Carries |
| --- | --- |
| `ready` | `agent`, `workspace`, `topics`, `scope`, `cursor`, `reconnectAt`, and `truncated`. |
| `events` | `events` (shaped as a webhook payload's events, with `eventId` and `reasons`) and `cursor`. |
| `reconnect` | `cursor` and a `reason`. The server closes right after. |
| `pong` | The answer to a `{"type":"ping"}` you send. |

Keep the latest `cursor` from any message. The only message you can send is `{"type":"ping"}`; anything else is ignored, and a message over 4,096 characters ends the stream.

As with webhooks, an event says what changed, not the whole object. Call `get_task`, `get_goal` or `collect_answers` to act on it.

### Resuming and `truncated`

Reconnect with `after=<cursor>` and the stream replays what you missed. It replays at most the last 24 hours. When your `after` reaches further back, `ready` says `truncated: true`; read `get_activity` for the rest. An `after` past the newest event starts from now.

## Delivery and de-duplication

Delivery is at least once. Event ids come from one sequence but can commit out of order, so each read also looks back over the last minute for events below the cursor that were not sent yet. That means:

- an event that committed late can arrive after one with a higher id;
- a reconnect can repeat the last minute's events.

De-duplicate by `eventId`, as you would for a webhook. The server reads the event log every 2 seconds.

## Close codes

| Code | Meaning | What to do |
| --- | --- | --- |
| 4000 | This connection's time is up. Sent after `reconnect`. | Reconnect at once with `after=<cursor>`. |
| 4401 | The agent lost access: revoked, expired, or its approver or parent gone. Checked every 30 seconds. | Stop, and tell the person. |
| 4429 | Too many open streams for this agent (its sub-agents count towards it) or the workspace, or this server is full. | Close one, or wait and retry. |
| 1013 | You read too slowly: more than 1 MiB of unsent data piled up. | Reconnect with `after`. |
| 1009 | You sent a message that was too large, or binary. | Send only `{"type":"ping"}`. |
| 1011 | Phean could not read events, check access, or start the stream. | Reconnect with backoff and `after`. |

On any other drop, reconnect with backoff and `after=<cursor>`.

## Limits

| Limit | Value |
| --- | --- |
| Connection lifetime | 270 seconds, then `reconnect` and 4000 (sooner if the token expires first). |
| Open streams per agent, its sub-agents included | 5 |
| Open streams per workspace | 50 |
| Replay window | 24 hours |
| Server pings | Every 25 seconds; a peer that does not answer is dropped. |

## A Node client

```js
import WebSocket from "ws"; // npm install ws

let cursor = null;
const seen = new Set(); // event ids handled, for de-duplication (keep the recent ones)
function listen() {
  const url = new URL(process.env.PHEAN_EVENTS_URL); // whoami's eventsUrl
  if (cursor !== null) url.searchParams.set("after", String(cursor));
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${process.env.PHEAN_TOKEN}` } });
  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if ("cursor" in message) cursor = message.cursor;
    if (message.type === "events") for (const event of message.events) if (!seen.has(event.eventId)) seen.add(event.eventId), handle(event); // your code
  });
  ws.on("close", (code) => {
    if (code === 4401) return; // revoked
    setTimeout(listen, code === 4000 ? 0 : 5_000);
  });
}
listen();
```

With a client that cannot set headers, pass the subprotocols instead:

```js
const ws = new WebSocket(url, ["phean.v1", `phean.bearer.${process.env.PHEAN_TOKEN}`]);
```
