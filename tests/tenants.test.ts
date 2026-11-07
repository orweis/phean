import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { addDays } from "@/lib/dates";
import { toMemberRole } from "@/lib/domain";
import { invitation } from "@/server/db/schema";
import {
  countMembers,
  findInvitation,
  findTenantBySlug,
  listMembers,
  listPendingInvitations,
} from "@/server/domain/tenants";

import { addMember, createTestDb, seedUser, seedWorkspace, type TestDb, type Workspace } from "./support/db";

let testDb: TestDb;
let ws: Workspace;

beforeAll(async () => {
  testDb = await createTestDb();
});

beforeEach(async () => {
  ws = await seedWorkspace(testDb.db);
});

afterAll(() => testDb.close());

async function invite(email: string, role: string | null, extra: { status?: string; expiresAt?: Date } = {}) {
  const id = `inv_${randomUUID()}`;
  await testDb.db.insert(invitation).values({
    id,
    organizationId: ws.tenant.id,
    email,
    role,
    status: extra.status ?? "pending",
    expiresAt: extra.expiresAt ?? addDays(new Date(), 7),
    inviterId: ws.human.actor.id,
  });
  return id;
}

describe("member roles", () => {
  it("reads Better Auth's role list as the most privileged role", () => {
    expect(toMemberRole("owner")).toBe("owner");
    expect(toMemberRole("member, admin")).toBe("admin");
    expect(toMemberRole("member,owner")).toBe("owner");
    expect(toMemberRole("member")).toBe("member");
    expect(toMemberRole("")).toBe("member");
    expect(toMemberRole(null)).toBe("member");
  });
});

describe("workspace membership reads", () => {
  it("lists members oldest first with normalized roles", async () => {
    const lee = await seedUser(testDb.db, "Lee");
    await addMember(testDb.db, ws.tenant, lee, "admin");

    const members = await listMembers(ws.human, {});
    expect(members.map((person) => [person.name, person.role])).toEqual([
      ["Dana", "owner"],
      ["Lee", "admin"],
    ]);
    expect(await countMembers(testDb.db, ws.tenant.id)).toBe(2);
  });

  it("shows only invitations that can still be accepted", async () => {
    await invite("lee@example.com", "admin");
    await invite("sam@example.com", null);
    await invite("old@example.com", "member", { expiresAt: addDays(new Date(), -1) });
    await invite("done@example.com", "member", { status: "accepted" });

    const pending = await listPendingInvitations(ws.human, {});
    expect(pending.map((pendingInvite) => [pendingInvite.email, pendingInvite.role])).toEqual([
      ["lee@example.com", "admin"],
      ["sam@example.com", "member"],
    ]);
  });

  it("resolves a share link to its workspace and inviter, whatever its status", async () => {
    const id = await invite("lee@example.com", "admin, member", { status: "accepted" });
    expect(await findInvitation(testDb.db, id)).toMatchObject({
      email: "lee@example.com",
      role: "admin",
      status: "accepted",
      tenant: ws.tenant,
      inviterName: "Dana",
    });
    expect(await findInvitation(testDb.db, "inv_missing")).toBeNull();
    expect(await findTenantBySlug(testDb.db, ws.tenant.slug)).toEqual(ws.tenant);
    expect(await findTenantBySlug(testDb.db, "no-such-workspace")).toBeNull();
  });
});
