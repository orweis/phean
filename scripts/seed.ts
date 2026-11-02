/**
 * Creates a demo account that owns two workspaces, issues fresh agent tokens for the first, and
 * fills the second with three weeks of backdated sample work.
 * Safe to re-run: existing users and workspaces are reused, and new tokens are issued each time.
 *
 *   pnpm db:seed
 *
 * With the default on-disk PGlite database, stop `pnpm dev` first (PGlite is single-process).
 */
import "./env";

import { eq } from "drizzle-orm";

import { auth } from "../src/server/auth/auth";
import { getDb } from "../src/server/db/client";
import { user } from "../src/server/db/schema";
import { createAgent } from "../src/server/domain/agents";
import { findTenantBySlug, listMemberships, userContext } from "../src/server/domain/tenants";
import { DEMO_USER, DEMO_WORKSPACES as WORKSPACES, SAMPLE_HISTORY_SLUG } from "./demo-account";
import { seedSampleHistory } from "./sample-history";

const AGENT_NAMES = ["Inbox sweeper", "Calendar planner"];

const db = getDb();

async function ensureUser() {
  const [existing] = await db.select().from(user).where(eq(user.email, DEMO_USER.email));
  if (existing) return existing;
  const { user: created } = await auth.api.signUpEmail({ body: DEMO_USER });
  return created;
}

async function ensureWorkspace(ownerId: string, workspace: { name: string; slug: string }) {
  if (await findTenantBySlug(db, workspace.slug)) return;
  await auth.api.createOrganization({ body: { ...workspace, userId: ownerId } });
}

const owner = await ensureUser();
for (const workspace of WORKSPACES) await ensureWorkspace(owner.id, workspace);

const memberships = await listMemberships(db, owner.id);
const primary = memberships.find((membership) => membership.tenant.slug === WORKSPACES[0]!.slug);
if (!primary) throw new Error(`Seeded user is not a member of ${WORKSPACES[0]!.slug}`);

const ctx = userContext(db, primary, owner);
const tokens = [];
for (const name of AGENT_NAMES) tokens.push(await createAgent(ctx, { name }));

const history = memberships.find((membership) => membership.tenant.slug === SAMPLE_HISTORY_SLUG);
const sampled = history ? await seedSampleHistory(db, history.tenant, owner) : 0;

console.log(`Sign in as ${DEMO_USER.email} / ${DEMO_USER.password}`);
console.log(`Workspaces: ${memberships.map((membership) => `/w/${membership.tenant.slug}`).join(", ")}`);
if (sampled) console.log(`Added ${sampled} sample tasks with three weeks of history to /w/${SAMPLE_HISTORY_SLUG}`);
console.log(`Agent tokens for /w/${primary.tenant.slug} (shown once):`);
for (const { agent, token } of tokens) console.log(`  ${agent.name}: ${token}`);
process.exit(0);
