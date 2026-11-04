---
name: phean-webhooks
description: How a bot receives Phean webhooks safely. Use when you run as a service connected to a Phean MCP server and want Phean to call you when people decide or when tasks, goals and memories you follow change. Covers registering the endpoint, verifying the Phean-Signature header (HMAC-SHA256, with copy-paste Node and Python verifiers), rejecting replays, de-duplicating retried events, and what to do with each event.
---

# Receiving Phean webhooks

Phean calls your HTTPS endpoint the moment something you care about changes. Anyone who learns the URL can POST to it too, so **verify every request before acting on it**. Each request is signed with a secret only you and Phean know.

## 1. Register and keep the secret

Call `register_webhook` with your `url` (HTTPS, on a public host), and optionally `topics` and `scope`. It returns:

- `webhook`: its id (`wh_…`), status, topics and scope.
- `secret`: `whsec_…`. **Shown once.** Store it in your secret store, never in code or logs.

Then call `ping_webhook`: Phean sends a signed `phean.ping` request, so you can check your verification code before real events arrive. Registering again rotates the secret; switch to the new one at once.

### If your endpoint needs its own key

Many endpoints (automation platforms, API gateways, serverless functions behind auth) reject requests that lack their own credential, so `ping_webhook` comes back `401` or `403`. Pass that credential in `headers` when you register:

```json
{ "url": "https://hooks.example.com/phean", "headers": { "Authorization": "Bearer <your endpoint's key>" } }
```

- Phean sends these headers with every delivery and ping, alongside its own signature. Keep verifying `Phean-Signature`: the endpoint key says who may call, the signature says the body is Phean's and unchanged.
- They are stored encrypted and never shown again; `get_webhook` lists their names only. Put credentials here, never in the URL or in chat.
- Up to 10 headers, one line each. Names Phean sets itself (`Content-Type`, `Host`, `User-Agent`, `Phean-*` and the like) are refused.
- Registering again keeps your headers unless you pass `headers`; `{}` removes them. So rotating the secret never drops your endpoint's key, and changing the key means registering with the new `headers`.

## 2. What a request looks like

```http
POST /your/path HTTP/1.1
Content-Type: application/json
User-Agent: Phean-Webhooks/1
Phean-Signature: t=1762250000,v1=9f2c…
Phean-Webhook-Id: wh_…
Phean-Delivery-Id: dl_…

{"type":"phean.events","deliveryId":"dl_…","webhookId":"wh_…","workspace":{…},"agent":{…},"sentAt":"…","events":[…]}
```

`type` is `phean.events`, or `phean.ping` (with no events) for `ping_webhook`.

## 3. Verify the signature

The `Phean-Signature` header is `t=<unix seconds>,v1=<hex>`. Phean computes:

```
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

## 4. Handle the events

- **Answer fast.** Return `2xx` within a few seconds and do the work afterwards (queue it). Phean waits at most 10 seconds, counts anything else (including redirects) as a failure, and retries.
- **De-duplicate by `eventId`.** Delivery is at least once: a batch can arrive again, for example if your 2xx was lost. Remember the event ids you have handled and skip repeats. Within one webhook, events arrive in order.
- **Read `reasons`** to see why you got each event:
  - `asked_by_you`: a person answered your question or decision, or took the answer back (`task.input_retracted`, which reopens the question);
  - `watching:task` / `watching:goal` / `watching:memory`: something you follow changed;
  - `in_watched_goal`: a change filed under a goal you follow;
  - `about_watched_task`: a memory about a task you follow;
  - `workspace`: you registered with `scope: "all"`.
- **Fetch the current state.** An event says what changed, not the whole object. Call `get_task`, `get_goal` or `recall` for the latest, and on `task.input_answered` call `collect_answers` to take the answer (that marks it delivered). Then act on it. A person can take an answer back for a few seconds after giving it, until you collect it: on `task.input_retracted` the question is open again, and `collect_answers` returns nothing for it, so wait for the next answer.
- **You never get your own changes,** so acting on an event does not echo back to you.

## 5. When things go wrong

- After a failure Phean backs off (30 s, 2 min, 8 min, … up to every 6 h) and retries the same events. After 12 failures in a row it **disables** the webhook and drops what was pending.
- `get_webhook` shows the status, the last error, delivery counts and recent deliveries. Registering again re-enables the webhook and rotates the secret.
- A leaked secret: register again at once to rotate it, and update your endpoint.

## Don'ts

- Don't act on a request whose signature you have not verified, or whose `t` is stale.
- Don't parse JSON before verifying, or verify a re-serialized body.
- Don't compare signatures with `==`.
- Don't log the secret or full signed requests.
- Don't do slow work before answering.
