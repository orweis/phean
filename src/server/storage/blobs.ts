import { del, get, list, put } from "@vercel/blob";
import { eq, inArray, like } from "drizzle-orm";

import { blobStoreConfig } from "../config";
import { documentBlobs } from "../db/schema";
import type { Db } from "../db/client";
import type { Tenant } from "../domain/context";

/** What a store needs of a context: the database (or transaction) and the tenant whose bytes it holds. */
export interface BlobScope {
  db: Db;
  tenant: Pick<Tenant, "id">;
}

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
  /** Deletes every object whose key starts with `prefix`: a deleted workspace's files, old versions included. */
  deletePrefix(prefix: string): Promise<void>;
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
    async deletePrefix(prefix) {
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, token, cursor, limit: 1000 });
        if (page.blobs.length) await del(page.blobs.map((blob) => blob.pathname), { token });
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    },
  };
}

/** Bytes in Postgres, inside the caller's transaction, for development and deployments without a store. */
function databaseStore(ctx: BlobScope): BlobStore {
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
    async deletePrefix(prefix) {
      await ctx.db.delete(documentBlobs).where(like(documentBlobs.key, `${prefix.replace(/[\\%_]/g, "\\$&")}%`));
    },
  };
}

/**
 * Vercel Blob, reading through to the database for documents stored there before the deployment
 * had a store, so turning a store on never strands them. Deletes clear both.
 */
function movingStore(token: string, ctx: BlobScope): BlobStore {
  const blob = vercelBlobStore(token);
  const database = databaseStore(ctx);
  return {
    driver: "vercel-blob",
    put: blob.put,
    async get(key) {
      return (await blob.get(key)) ?? (await database.get(key));
    },
    async delete(keys) {
      await Promise.all([blob.delete(keys), database.delete(keys)]);
    },
    async deletePrefix(prefix) {
      await Promise.all([blob.deletePrefix(prefix), database.deletePrefix(prefix)]);
    },
  };
}

export function blobStore(ctx: BlobScope): BlobStore {
  const config = blobStoreConfig();
  return config.driver === "vercel-blob" ? movingStore(config.token, ctx) : databaseStore(ctx);
}

/** Where a version of a document's bytes lives; versions never overwrite each other. */
export const documentKey = (tenantId: string, documentId: string, version: number) => `${tenantKeyPrefix(tenantId)}documents/${documentId}/v${version}`;

/** Every key of a tenant's starts with this, so deleting a workspace can clear its files by prefix. */
export const tenantKeyPrefix = (tenantId: string) => `tenants/${tenantId}/`;
