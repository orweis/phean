"use server";

import { GOAL_STATUS_META } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { tenantAction } from "@/server/actions";
import { cancelInvitation, inviteMember, removeMember } from "@/server/auth/workspaces";
import { createAgent, revokeAgent } from "@/server/domain/agents";
import { attachDocument, deleteDocument, updateDocument } from "@/server/domain/documents";
import { createGoal, setGoalStatus, updateGoal } from "@/server/domain/goals";
import { forget, remember, updateMemory } from "@/server/domain/memory";
import { deleteWebhook } from "@/server/domain/webhooks";
import { saveWorkflow } from "@/server/domain/workflow";
import { addTask, answerInput, completeTask, releaseTask, retractAnswer, updateTask } from "@/server/domain/tasks";

// Goals
export const createGoalAction = tenantAction(createGoal, {
  redirectTo: (goal, ctx) => routes.goal(ctx.tenant.slug, goal.id),
});
export const updateGoalAction = tenantAction(updateGoal, { success: "Saved." });
export const setGoalStatusAction = tenantAction(setGoalStatus, {
  success: (goal) => `Goal is now ${GOAL_STATUS_META[goal.status].label.toLowerCase()}.`,
});

// Tasks
export const addTaskAction = tenantAction(addTask, {
  success: ({ created }) => (created.length ? "Task added." : "Already tracked from that source."),
});
export const updateTaskAction = tenantAction(updateTask, { success: "Saved." });
export const completeTaskAction = tenantAction(completeTask, { success: "Done." });
export const releaseTaskAction = tenantAction(releaseTask, { success: "Released." });
export const answerInputAction = tenantAction(answerInput, { success: "Answered." });
export const retractAnswerAction = tenantAction(retractAnswer, { success: "Answer taken back." });

// Memory
export const rememberAction = tenantAction(remember, { success: "Saved to memory." });
export const forgetAction = tenantAction(forget, { success: "Forgotten." });
export const updateMemoryAction = tenantAction(updateMemory, { success: "Saved." });

// Documents
export const createDocumentAction = tenantAction(attachDocument, {
  redirectTo: (document, ctx) => routes.document(ctx.tenant.slug, document.id, "edit"),
});
export const updateDocumentAction = tenantAction(updateDocument, {
  redirectTo: (document, ctx) => routes.document(ctx.tenant.slug, document.id),
});
export const deleteDocumentAction = tenantAction(deleteDocument, { redirectTo: (_result, ctx) => routes.documents(ctx.tenant.slug) });

// Agents
export const createAgentAction = tenantAction(createAgent, {
  data: ({ agent, token }) => ({ token, agentName: agent.name }),
});
export const revokeAgentAction = tenantAction(revokeAgent, {
  success: (agent) => `Revoked ${agent.name}.`,
});
export const deleteWebhookAction = tenantAction(deleteWebhook, { success: "Webhook removed." });

// Settings
export const saveWorkflowAction = tenantAction(saveWorkflow, { success: "Saved the board's stages." });

// Members
export const inviteMemberAction = tenantAction(inviteMember, {
  data: ({ id, email }) => ({ invitationId: id, email }),
});
export const cancelInvitationAction = tenantAction(cancelInvitation, { success: "Invitation cancelled." });
export const removeMemberAction = tenantAction(removeMember, { success: "Member removed." });
