import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, seedWorkspace, type TestDb } from "./support/db";

const calls: { op: string; key: unknown; options: Record<string, unknown> }[] = [];

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (key: string, _body: unknown, options: Record<string, unknown>) => {
    calls.push({ op: "put", key, options });
    return { pathname: key };
  }),
  get: vi.fn(async (key: string, options: Record<string, unknown>) => {
    calls.push({ op: "get", key, options });
    if (key.includes("before-the-store")) return null;
    return { statusCode: 200, stream: new Response(new Uint8Array([1, 2, 3])).body, blob: {} };
  }),
  del: vi.fn(async (keys: unknown, options: Record<string, unknown>) => {
    calls.push({ op: "del", key: keys, options });
  }),
  // Two pages under any prefix, so deleting by prefix has to follow the cursor.
  list: vi.fn(async (options: Record<string, unknown>) => {
    calls.push({ op: "list", key: options.prefix, options });
    const page = options.cursor === "page-2" ? 2 : 1;
    return { blobs: [{ pathname: `${String(options.prefix)}documents/d_${page}/v1` }], hasMore: page === 1, cursor: page === 1 ? "page-2" : undefined };
  }),
}));

const { blobStore, documentKey, tenantKeyPrefix } = await import("@/server/storage/blobs");
const { documentBlobs } = await import("@/server/db/schema");
const { eq } = await import("drizzle-orm");

const ctx = { db: {} as never, tenant: { id: "org_1", slug: "acme", name: "Acme" }, actor: { type: "user" as const, id: "u", name: "U", role: "owner" as const } };

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

afterEach(() => {
  vi.unstubAllEnvs();
  calls.length = 0;
});

describe("the document blob store", () => {
  it("keeps every document under its tenant, one key per version", () => {
    expect(documentKey("org_1", "d_abc", 3)).toBe("tenants/org_1/documents/d_abc/v3");
  });

  it("uses private Vercel Blob storage when a store's token is set, so no blob is public", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
    const { human } = await seedWorkspace(testDb.db);
    const store = blobStore(human);
    expect(store.driver).toBe("vercel-blob");
    await store.put("tenants/org_1/documents/d_1/v1", new Uint8Array([1]), "text/markdown");
    expect(await store.get("tenants/org_1/documents/d_1/v1")).toEqual(new Uint8Array([1, 2, 3]));
    await store.delete(["tenants/org_1/documents/d_1/v1"]);
    expect(calls.map((call) => [call.op, call.options.access, call.options.token])).toEqual([
      ["put", "private", "vercel_blob_rw_test"],
      ["get", "private", "vercel_blob_rw_test"],
      ["del", undefined, "vercel_blob_rw_test"],
    ]);
    expect(calls[0]!.options).toMatchObject({ addRandomSuffix: false, contentType: "text/markdown" });
  });

  it("still reads documents stored in the database before the store was turned on, and deletes clear both", async () => {
    const { human } = await seedWorkspace(testDb.db);
    const key = `tenants/${human.tenant.id}/documents/before-the-store/v1`;
    await blobStore(human).put(key, new Uint8Array([7, 8]), "text/markdown");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
    const store = blobStore(human);
    expect(store.driver).toBe("vercel-blob");
    expect(await store.get(key)).toEqual(new Uint8Array([7, 8]));
    await store.delete([key]);
    expect(calls.map((call) => call.op)).toEqual(["get", "del"]);
    vi.unstubAllEnvs();
    expect(await blobStore(human).get(key)).toBeNull();
  });

  it("deletes a tenant's files by prefix in Vercel Blob, page after page, and in the database alongside", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
    const { human } = await seedWorkspace(testDb.db);
    const prefix = tenantKeyPrefix(human.tenant.id);
    await blobStore(human).deletePrefix(prefix);
    expect(calls.map((call) => [call.op, call.key, call.options.token])).toEqual([
      ["list", prefix, "vercel_blob_rw_test"],
      ["del", [`${prefix}documents/d_1/v1`], "vercel_blob_rw_test"],
      ["list", prefix, "vercel_blob_rw_test"],
      ["del", [`${prefix}documents/d_2/v1`], "vercel_blob_rw_test"],
    ]);
    expect(calls[2]!.options.cursor).toBe("page-2");
  });

  it("deletes by prefix in the database store, and only that prefix, wildcards in it taken literally", async () => {
    const { human } = await seedWorkspace(testDb.db);
    const other = await seedWorkspace(testDb.db);
    const store = blobStore(human);
    const keys = [`${tenantKeyPrefix(human.tenant.id)}documents/d_1/v1`, `${tenantKeyPrefix(human.tenant.id)}documents/d_1/v2`];
    for (const key of keys) await store.put(key, new Uint8Array([1]), "text/markdown");
    const theirs = `${tenantKeyPrefix(other.tenant.id)}documents/d_9/v1`;
    await blobStore(other.human).put(theirs, new Uint8Array([2]), "text/markdown");
    // "_" and "%" are LIKE wildcards: a prefix holding them must not reach keys that only look alike.
    const lookalike = { db: testDb.db, tenant: { id: human.tenant.id } };
    await blobStore(lookalike).put("tenants/aXb/documents/d/v1", new Uint8Array([3]), "text/markdown");
    await blobStore(lookalike).deletePrefix("tenants/a_b/");
    await blobStore(lookalike).deletePrefix("tenants/%/");
    expect(await blobStore(lookalike).get("tenants/aXb/documents/d/v1")).toEqual(new Uint8Array([3]));

    await store.deletePrefix(tenantKeyPrefix(human.tenant.id));
    for (const key of keys) expect(await store.get(key)).toBeNull();
    expect(await blobStore(other.human).get(theirs)).toEqual(new Uint8Array([2]));
    expect(await testDb.db.select({ key: documentBlobs.key }).from(documentBlobs).where(eq(documentBlobs.tenantId, human.tenant.id))).toEqual([{ key: "tenants/aXb/documents/d/v1" }]);
  });

  it("falls back to the database without a token, or when told to", () => {
    expect(blobStore(ctx).driver).toBe("database");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
    vi.stubEnv("PHEAN_BLOB_DRIVER", "database");
    expect(blobStore(ctx).driver).toBe("database");
  });
});
