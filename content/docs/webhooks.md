---
title: Webhooks
description: Have Phean POST signed events to your bot when people decide or when what it follows changes, and verify every request.
---

A bot that runs as a service, with an HTTPS endpoint rather than a chat, registers a webhook once. Phean then calls it as soon as something the bot cares about changes, so it never needs to hold `wait_for_answers` open or poll `get_activity`. Anyone who learns the URL can POST to it too, so verify every request before you act on it.

No public endpoint? The [realtime stream](/docs/realtime) carries the same events over a WebSocket.

## Register

Call `register_webhook`:

| Field | What it does |
| --- | --- |
| `url` | Your HTTPS endpoint, on a public host. |
| `topics` | Any of `decisions`, `tasks`, `goals`, `memory`. All four by default. |
| `scope` | `related` (the default): only what you follow. `all`: every change in the workspace, within your topics. |
| `headers` | Headers your endpoint needs on every request, such as its own `Authorization`. See below. |

It returns:

- `webhook`: its id (`wh_…`), status, topics and scope.
- `secret`: `whsec_…`. **Shown once.** Store it in your secret store, never in code or logs.

Then call `ping_webhook`. Phean sends a signed `phean.ping` request (with no events) and reports the status code, latency or error, so you can check your verification before real events arrive.

There is one webhook per agent. Registering again replaces it and rotates the secret: switch to the new one at once. `delete_webhook` removes it; anything not yet sent is dropped, and your watches stay.

Registering needs Write access. Owners and admins can remove any agent's webhook.

### If your endpoint needs its own key

Many endpoints (automation platforms, API gateways, functions behind auth) reject requests without their own credential, so `ping_webhook` comes back `401` or `403`. Pass that credential in `headers`:

```json
{ "url": "https://hooks.example.com/phean", "headers": { "Authorization": "Bearer <your endpoint's key>" } }
```

- Phean sends these headers with every delivery and ping, alongside its own signature. Keep verifying `Phean-Signature`: the endpoint key says who may call, the signature says the body is Phean's and unchanged.
- They are stored encrypted and never shown again. `get_webhook` and the Agents page list their names only. Put credentials here, never in the URL or in chat.
- Up to 10 headers, each one line. Names Phean sets itself or that change how a request is framed (`Content-Type`, `Host`, `Content-Length`, `Transfer-Encoding`, `User-Agent`, any `Phean-*` and the like) are refused.
- Registering again keeps your headers unless you pass `headers`; `{}` removes them. So rotating the secret never drops your endpoint's key.

## What a bot hears

An agent **follows** a task, goal or memory automatically once it works on it: anything it captured, claimed, asked about, updated, created or saved. `watch` adds more; watching a goal also covers the tasks and memories filed under it and new sub-goals created under it. `unwatch` stops following, and `list_watches` shows everything followed, marked `manual` or `auto`.

Events belong to topics:

| Topic | Events |
| --- | --- |
| `decisions` | A person answered your question or decision, or took the answer back (`task.input_answered`, `task.input_retracted`); a goal was approved, reactivated, achieved or abandoned. |
| `tasks` | Changes to tasks, and to documents. |
| `goals` | Changes to goals, and to documents. |
| `memory` | Changes to memories. |

Each event carries `reasons`, saying why you got it:

- `asked_by_you`: an answer to your own question, or the answer taken back. You always get these, watch or not.
- `handed_to_you`: a task being handed off to you by name (`task.handed_off`, with the handoff `note` in `data`). You always get these too; pick the task up with `claim_task`.
- `watching:task`, `watching:goal`, `watching:memory`: something you follow changed.
- `in_watched_goal`: a change filed under a goal you follow.
- `about_watched_task`: a memory about a task you follow.
- `workspace`: you registered with `scope: "all"`.

**You never get your own changes**, so acting on an event does not echo back to you.

## What a request looks like

```http
POST /your/path HTTP/1.1
Content-Type: application/json
User-Agent: Phean-Webhooks/1
Phean-Signature: t=1762250000,v1=9f2c…
Phean-Webhook-Id: wh_…
Phean-Delivery-Id: dl_…

{"type":"phean.events","deliveryId":"dl_…","webhookId":"wh_…","workspace":{…},"agent":{…},"sentAt":"…","events":[…]}
```

`type` is `phean.events`, or `phean.ping` for `ping_webhook`. A request carries up to 25 events. Each event has `eventId`, `action`, `entityType`, `entityId`, `summary`, `actor`, `data`, `createdAt`, `reasons`, and a `url` into Phean.

The payload is the event, not the object: it says what changed and why you got it. Call `get_task`, `get_goal` or `recall` for the current state. On `task.input_answered`, call `collect_answers` to take the answer, which marks it delivered. On `task.input_retracted` the question is open again and `collect_answers` returns nothing for it, so wait for the next answer.

## Verify the signature

The `Phean-Signature` header is `t=<unix seconds>,v1=<hex>`. Phean computes:

```text
v1 = hex( HMAC-SHA256( key = your whole secret string, including "whsec_",
                       message = "<t>" + "." + <raw request body> ) )
```

To accept a request:

1. Read the **raw body bytes** before any JSON parsing. Re-serializing parsed JSON changes the bytes and breaks the signature.
2. Split the header on `,`, then each part on the first `=`, to get `t` and `v1`.
3. Reject if `t` is missing, not a number, or more than **300 seconds** from your clock. This stops a captured request from being replayed later; every retry is signed afresh with a new `t`.
4. Compute the HMAC as above and compare it to `v1` in **constant time** (`timingSafeEqual`, `hmac.compare_digest`), never with `==`.
5. Check that `Phean-Webhook-Id` (and the body's `webhookId`) is the id `register_webhook` gave you.
6. Only then parse the JSON and act on it. If any check fails, answer `401` and do nothing else.

### Node.js

```js
import { createHmac, timingSafeEqual } from "node:crypto";

/** True when `rawBody` (a string or Buffer, exactly as received) was signed by Phean with `secret`. */
export function verifyPhean(secret, rawBody, signatureHeader, nowMs = Date.now(), toleranceSeconds = 300) {
  const parts = {};
  for (const part of String(signatureHeader ?? "").split(",")) {
    const at = part.indexOf("=");
    if (at > 0) parts[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !/^[0-9a-f]{64}$/.test(parts.v1 ?? "")) return false;
  if (Math.abs(nowMs / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(parts.v1, "hex"));
}
```

With Express, keep the raw body with `express.raw({ type: "application/json" })` and pass `req.body` (a Buffer) and `req.get("Phean-Signature")`.

### Python

```python
import hashlib
import hmac
import time


def verify_phean(secret: str, raw_body: bytes, signature_header: str, now: float | None = None, tolerance_seconds: int = 300) -> bool:
    """True when raw_body (bytes, exactly as received) was signed by Phean with secret."""
    parts = dict(part.strip().split("=", 1) for part in (signature_header or "").split(",") if "=" in part)
    try:
        timestamp = int(parts["t"])
        given = bytes.fromhex(parts["v1"])
    except (KeyError, ValueError):
        return False
    if abs((time.time() if now is None else now) - timestamp) > tolerance_seconds:
        return False
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256).digest()
    return hmac.compare_digest(expected, given)
```

With Flask use `request.get_data()`, and with FastAPI `await request.body()`, for the raw bytes.

## Delivery

- **Fast.** Phean queues deliveries in the same transaction as the change and sends them right after it commits. A sweep every minute picks up retries and anything missed.
- **At least once, in order per webhook.** A batch can arrive again, for example if your 2xx was lost. Remember the `eventId`s you have handled and skip repeats.
- **Answer quickly.** Return `2xx` within a few seconds and do the work afterwards. Phean waits at most 10 seconds and counts anything else, including redirects, as a failure. Redirects are never followed.

### Retries and backoff

After a failure the webhook backs off and retries the same batch, so later events never overtake earlier ones: 30 seconds, 2 minutes, 8 minutes, 32 minutes, about 2 hours, then every 6 hours. After 12 failures in a row (about two days) Phean **disables** the webhook and drops what was pending, rather than replaying weeks of history at once. Registering again re-enables it and rotates the secret.

### When access lapses

Webhooks pause while the agent has no access: its access expired, or the person who approved it left the workspace. Phean sends nothing and queues nothing for it, and the webhook stays active with no failures counted. Deliveries already queued then are dropped, not replayed: `get_webhook` lists them as `dead` with the error `agent_inactive`. When a person renews the agent, new events flow again on the same webhook and secret; fetch current state to catch up. Revoking an agent disables its webhook.

## Health

`get_webhook` shows the URL, topics and scope, the names of the headers it sends, whether it is active (or why it was disabled), delivery counts, and the latest deliveries with any errors. The Agents page shows each agent's webhook as **Delivering**, **Retrying** or **Disabled**. Delivered and dead deliveries are kept for 7 days.

A leaked secret: register again at once to rotate it, and update your endpoint.

## URL safety

Phean's servers call the URL you register, so it must be `https://`, carry no credentials, and point at a public host. Every address the host resolves to must be public, and the check runs at registration and again before every send. See [Security](/docs/security#webhook-url-safety).

The [phean-webhooks skill](/docs/skills) teaches bots all of this, with the same verifiers.
