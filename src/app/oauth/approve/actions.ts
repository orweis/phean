"use server";

import { headers } from "next/headers";
import type { z } from "zod";

import type { ActionState } from "@/lib/action-state";
import { ACCESS_LEVEL_META } from "@/lib/domain";
import { authorizeRetryPath, consentScope, levelField, NEW_AGENT, renewalKey, type ConsentOutcome } from "@/lib/oauth-consent";
import { attempt } from "@/server/actions";
import { auth, completeConsent } from "@/server/auth/auth";
import { readConsentRequest } from "@/server/auth/consent";
import { getSession, ownMemberships, personContext } from "@/server/auth/session";
import { approveAgentThen, findReconnectableAgent, findRenewableAgent, listOwnAgents, revokeAgent } from "@/server/domain/agents";
import { transferClaims } from "@/server/domain/tasks";
import { invalid } from "@/server/domain/errors";
import { ApproveAgentInput } from "@/server/domain/schemas";
import { formToInput } from "@/server/forms";

/**
 * The browser goes on from the form rather than through `redirect()`: a custom scheme such as
 * `cursor://` leaves the page on screen, and the form must then replace its live Allow.
 */
function goOn(navigate: string, outcome: ConsentOutcome): ActionState {
  return { status: "success", data: { navigate, outcome }, at: Date.now() };
}

/**
 * Allow or Cancel. Everything comes from the session and the signed query, and the posted workspace,
 * agent to reconnect and agents whose work to take over are only ever looked up among the person's
 * own memberships and agents. The agent is approved before the
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
  const membership = (await ownMemberships(session.user)).find(({ tenant }) => tenant.slug === slug);
  if (!membership) return { status: "error", message: "Choose one of your workspaces.", at: Date.now() };
  const ctx = personContext(membership, session.user);

  // The agent to reconnect is posted by the browser, so it is looked up again among this person's own.
  const chosenId = String(formData.get("agent") ?? "");
  const chosen = chosenId && chosenId !== NEW_AGENT ? await findReconnectableAgent(ctx, chosenId) : null;
  if (chosenId && chosenId !== NEW_AGENT && !chosen) return { status: "error", message: "Choose one of your agents in this workspace, or connect a new one.", at: Date.now() };

  const name = String(formData.get("name") ?? "");
  const key = renewalKey(slug, name);
  // The warning has to have been on screen for this workspace and name before Allow replaces anything.
  if (!chosen && formData.get("replaces") !== key) {
    const renewable = await findRenewableAgent(ctx, name);
    if (renewable) return { status: "idle", data: { replaces: key, otherClient: renewable.oauthClientId !== request.clientId }, at: Date.now() };
  }

  // Agents whose work the approved one takes over, and which of those to revoke: only this person's
  // own agents here, as the dialog offered them; the transfer checks each again.
  const own = await listOwnAgents(ctx);
  const takeOver = [...new Set(formData.getAll("takeOver").map(String))];
  const revoke = [...new Set(formData.getAll("revoke").map(String))].filter((id) => takeOver.includes(id));
  const renewing = chosen ?? own.find((agent) => agent.name === name.trim());
  if (takeOver.some((id) => !own.some((agent) => agent.id === id))) return { status: "error", message: "Choose whose work to take over among your own agents here.", at: Date.now() };
  if (renewing && takeOver.includes(renewing.id)) return { status: "error", message: `"${renewing.name}" cannot take over its own work. Untick it, or connect another agent.`, at: Date.now() };

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
    // The work moves to the approved agent, and anyone ticked is revoked, before the client has its
    // code; a renewal replaces the old connection only once the new client has it.
    const consent = async (agentId: string) => {
      for (const fromAgentId of takeOver) await transferClaims(ctx, { fromAgentId, toAgentId: agentId });
      for (const revoked of revoke) await revokeAgent(ctx, { agentId: revoked });
      return completeConsent(auth, requestHeaders, { agentId, oauthQuery, scope: scope ?? undefined });
    };
    const grant = { ...input, oauthClientId: request.clientId };
    const approval = chosen ? { level: grant.level, lifetimeDays: grant.lifetimeDays, oauthClientId: grant.oauthClientId, agentId: chosen.id } : grant;
    return (await approveAgentThen(ctx, approval, consent, { tookOverWork: takeOver.length > 0 })).issued;
  });
  return allowed.ok ? goOn(allowed.value.url, "allowed") : allowed.state;
}
