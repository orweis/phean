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
}));

const { blobStore, documentKey } = await import("@/server/storage/blobs");

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

  it("falls back to the database without a token, or when told to", () => {
    expect(blobStore(ctx).driver).toBe("database");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
    vi.stubEnv("PHEAN_BLOB_DRIVER", "database");
    expect(blobStore(ctx).driver).toBe("database");
  });
});
