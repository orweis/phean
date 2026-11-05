"use server";

import { headers } from "next/headers";
import type { z } from "zod";

import type { ActionState } from "@/lib/action-state";
import { authorizeRetryPath, consentScope, levelField, renewalKey, type ConsentOutcome } from "@/lib/oauth-consent";
import { attempt } from "@/server/actions";
import { auth, completeConsent } from "@/server/auth/auth";
import { readConsentRequest } from "@/server/auth/consent";
import { getSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { approveAgent, findRenewableAgent } from "@/server/domain/agents";
import { ApproveAgentInput } from "@/server/domain/schemas";
import { listMemberships, userContext } from "@/server/domain/tenants";
import { formToInput } from "@/server/forms";

/**
 * The browser goes on from the form rather than through `redirect()`: a custom scheme such as
 * `cursor://` leaves the page on screen, and the form must then replace its live Allow.
 */
function goOn(navigate: string, outcome: ConsentOutcome): ActionState {
  return { status: "success", data: { navigate, outcome }, at: Date.now() };
}

/**
 * Allow or Cancel. Everything comes from the session and the signed query, and the posted workspace
 * is only ever looked up among the person's own memberships. The agent is approved before the
 * consent call, so the code is bound to a row that already exists.
 */
export async function decideConsentAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const oauthQuery = String(formData.get("oauthQuery") ?? "");
  const request = await readConsentRequest(auth, oauthQuery);
  if (request.status === "invalid") return { status: "error", message: "This connection request is not valid. Start again from your client.", at: Date.now() };
  if (request.status === "stale") return goOn(request.retryPath, "resume");

  const session = await getSession();
  if (!session) return goOn(authorizeRetryPath(oauthQuery), "resume");
  const requestHeaders = await headers();

  if (formData.get("decision") === "decline") {
    const declined = await attempt(() => completeConsent(auth, requestHeaders, { agentId: null, oauthQuery }));
    return declined.ok ? goOn(declined.value.url, "declined") : declined.state;
  }

  const slug = String(formData.get("workspace") ?? "");
  // A client on a workspace's own URL gets a token only for that workspace, so the agent must work there.
  if (request.workspace !== null && slug !== request.workspace) return { status: "error", message: "This client connects to another workspace's address.", at: Date.now() };
  const membership = (await listMemberships(getDb(), session.user.id)).find(({ tenant }) => tenant.slug === slug);
  if (!membership) return { status: "error", message: "Choose one of your workspaces.", at: Date.now() };
  const ctx = userContext(getDb(), membership, session.user);

  const name = String(formData.get("name") ?? "");
  const key = renewalKey(slug, name);
  // The warning has to have been on screen for this workspace and name before Allow replaces anything.
  if (formData.get("replaces") !== key) {
    const renewable = await findRenewableAgent(ctx, name);
    if (renewable) return { status: "idle", data: { replaces: key, otherClient: renewable.oauthClientId !== request.clientId }, at: Date.now() };
  }

  // Each workspace's levels are their own radio group, so the level is the chosen row's and no other.
  const fields = new FormData();
  for (const field of ["name", "lifetimeDays"]) for (const value of formData.getAll(field)) fields.append(field, value);
  for (const value of formData.getAll(levelField(slug))) fields.append("level", value);

  const allowed = await attempt(async () => {
    const input = formToInput(fields, ApproveAgentInput) as Omit<z.input<typeof ApproveAgentInput>, "oauthClientId">;
    const { agent } = await approveAgent(ctx, { ...input, oauthClientId: request.clientId });
    return completeConsent(auth, requestHeaders, { agentId: agent.id, oauthQuery, scope: consentScope(request.scope, agent.accessLevel) });
  });
  return allowed.ok ? goOn(allowed.value.url, "allowed") : allowed.state;
}
