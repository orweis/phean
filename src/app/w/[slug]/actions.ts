"use server";

import { GOAL_STATUS_META } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { tenantAction } from "@/server/actions";
import { cancelInvitation, inviteMember, removeMember } from "@/server/auth/workspaces";
import { createAgent, revokeAgent } from "@/server/domain/agents";
import { createGoal, setGoalStatus, updateGoal } from "@/server/domain/goals";
import { forget, remember } from "@/server/domain/memory";
import { TaskDraft } from "@/server/domain/schemas";
import { captureTasks, completeTask, releaseTask, updateTask } from "@/server/domain/tasks";

// Goals
export const createGoalAction = tenantAction(createGoal.schema, createGoal, {
  redirectTo: (goal, ctx) => routes.goal(ctx.tenant.slug, goal.id),
});
export const updateGoalAction = tenantAction(updateGoal.schema, updateGoal, { success: "Saved." });
export const setGoalStatusAction = tenantAction(setGoalStatus.schema, setGoalStatus, {
  success: (goal) => `Goal is now ${GOAL_STATUS_META[goal.status].label.toLowerCase()}.`,
});

// Tasks
export const addTaskAction = tenantAction(TaskDraft, (ctx, draft) => captureTasks(ctx, { tasks: [draft] }), {
  success: ({ created }) => (created.length ? "Task added." : "Already tracked from that source."),
});
export const updateTaskAction = tenantAction(updateTask.schema, updateTask, { success: "Saved." });
export const completeTaskAction = tenantAction(completeTask.schema, completeTask, { success: "Done." });
export const releaseTaskAction = tenantAction(releaseTask.schema, releaseTask, { success: "Released." });

// Memory
export const rememberAction = tenantAction(remember.schema, remember, { success: "Saved to memory." });
export const forgetAction = tenantAction(forget.schema, forget, { success: "Forgotten." });

// Agents
export const createAgentAction = tenantAction(createAgent.schema, createAgent, {
  data: ({ agent, token }) => ({ token, agentName: agent.name }),
});
export const revokeAgentAction = tenantAction(revokeAgent.schema, revokeAgent, {
  success: (agent) => `Revoked ${agent.name}.`,
});

// Members
export const inviteMemberAction = tenantAction(inviteMember.schema, inviteMember, {
  data: ({ id, email }) => ({ invitationId: id, email }),
});
export const cancelInvitationAction = tenantAction(cancelInvitation.schema, cancelInvitation, { success: "Invitation cancelled." });
export const removeMemberAction = tenantAction(removeMember.schema, removeMember, { success: "Member removed." });
