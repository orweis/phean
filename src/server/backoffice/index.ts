/**
 * The backoffice's services: cross-tenant, read-only, for platform admins, each audited. Every one is
 * listed here, so the policy and isolation tests can refuse each in turn.
 */
export { getActivation } from "./activation";
export { getAgentsReport } from "./agents";
export { listAuditLog } from "./audit-log";
export { getSystemHealth } from "./health";
export { getOverview } from "./overview";
export { searchPeople } from "./people";
export { getProductUsage } from "./usage";
export { exportWorkspaces, getWorkspaceContent, getWorkspaceDetail, listWorkspaces, revealContent, type WorkspaceContent, type WorkspaceDetail } from "./workspaces";
