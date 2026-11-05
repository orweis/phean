import { del, get, put } from "@vercel/blob";
import { eq, inArray } from "drizzle-orm";

import { blobStoreConfig } from "../config";
import { documentBlobs } from "../db/schema";
import type { Ctx } from "../domain/context";

/**
 * Document bytes, by key. Keys always start with the tenant's id (`tenants/<id>/…`), and only
 * services reach this store, after they have checked the document is in the acting tenant, so no
 * blob is ever addressed by a URL a browser holds.
 */
export interface BlobStore {
  driver: "vercel-blob" | "database";
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(keys: readonly string[]): Promise<void>;
}

/** Private Vercel Blob storage: reads and writes need the token, so nothing is public. */
function vercelBlobStore(token: string): BlobStore {
  return {
    driver: "vercel-blob",
    async put(key, data, contentType) {
      await put(key, Buffer.from(data), { access: "private", token, contentType, addRandomSuffix: false, allowOverwrite: true });
    },
    async get(key) {
      const result = await get(key, { access: "private", token, useCache: false });
      if (!result || !result.stream) return null;
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
    async delete(keys) {
      if (keys.length) await del([...keys], { token });
    },
  };
}

/** Bytes in Postgres, inside the caller's transaction, for development and deployments without a store. */
function databaseStore(ctx: Ctx): BlobStore {
  return {
    driver: "database",
    async put(key, data) {
      await ctx.db
        .insert(documentBlobs)
        .values({ key, tenantId: ctx.tenant.id, data })
        .onConflictDoUpdate({ target: documentBlobs.key, set: { data } });
    },
    async get(key) {
      const [row] = await ctx.db.select({ data: documentBlobs.data }).from(documentBlobs).where(eq(documentBlobs.key, key));
      return row ? new Uint8Array(row.data) : null;
    },
    async delete(keys) {
      if (keys.length) await ctx.db.delete(documentBlobs).where(inArray(documentBlobs.key, [...keys]));
    },
  };
}

export function blobStore(ctx: Ctx): BlobStore {
  const config = blobStoreConfig();
  return config.driver === "vercel-blob" ? vercelBlobStore(config.token) : databaseStore(ctx);
}

/** Where a version of a document's bytes lives; versions never overwrite each other. */
export const documentKey = (tenantId: string, documentId: string, version: number) => `tenants/${tenantId}/documents/${documentId}/v${version}`;
