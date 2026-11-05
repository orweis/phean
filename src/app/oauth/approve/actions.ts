"use server";

import { headers } from "next/headers";
import type { z } from "zod";

import type { ActionState } from "@/lib/action-state";
import { ACCESS_LEVEL_META } from "@/lib/domain";
import { authorizeRetryPath, consentScope, levelField, renewalKey, type ConsentOutcome } from "@/lib/oauth-consent";
import { attempt } from "@/server/actions";
import { auth, completeConsent } from "@/server/auth/auth";
import { readConsentRequest } from "@/server/auth/consent";
import { getSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { approveAgentThen, findRenewableAgent } from "@/server/domain/agents";
import { invalid } from "@/server/domain/errors";
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
    // Checked before approving, so a refused choice leaves no agent behind.
    const level = ApproveAgentInput.shape.level.safeParse(input.level);
    const scope = level.success ? consentScope(request.scope, level.data) : undefined;
    if (scope === null && level.success) throw invalid(`This client asked only for more than ${ACCESS_LEVEL_META[level.data].label} access. Choose a higher level, or Cancel.`);
    // A renewal replaces the old connection only once the new client has its code.
    const consent = (agentId: string) => completeConsent(auth, requestHeaders, { agentId, oauthQuery, scope: scope ?? undefined });
    return (await approveAgentThen(ctx, { ...input, oauthClientId: request.clientId }, consent)).issued;
  });
  return allowed.ok ? goOn(allowed.value.url, "allowed") : allowed.state;
}
