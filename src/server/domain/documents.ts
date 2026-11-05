import { createHash } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { DOCUMENT_FORMAT_META, isTextFormat, type DocumentFormat } from "@/lib/documents";
import { LIMITS } from "@/lib/domain";

import { publicColumns } from "../db/columns";
import { matchesTsQuery, prefixTsQuery } from "../db/fts";
import { newId } from "../db/ids";
import { documents, goals, tasks, type DocumentRow } from "../db/schema";
import { blobStore, documentKey } from "../storage/blobs";
import { createdByFields, inTenant, inTransaction, onCommit, tenantRow, type Ctx } from "./context";
import { conflict, forbidden, invalid, notFound } from "./errors";
import { recordEvent } from "./events";
import { assertGoalsExist } from "./goals";
import { assertCan } from "./policy";
import { AttachDocumentInput, DocumentRefInput, ListDocumentsInput, UpdateDocumentInput } from "./schemas";
import { service } from "./service";
import { findTask } from "./tasks";

export type Document = Omit<DocumentRow, "tenantId" | "search" | "storageKey">;

const documentColumns = publicColumns(documents, ["tenantId", "search", "storageKey"]);

/** A document with what it holds: text for text formats, base64 for pdf and images. */
export interface DocumentWithContent {
  document: Document;
  content?: string;
  contentBase64?: string;
}

/** The bytes a request carries, checked against its format and the size limits. */
function bytesOf(format: DocumentFormat, body: { content?: string; contentBase64?: string }): Uint8Array {
  if (isTextFormat(format)) {
    if (body.contentBase64 !== undefined) throw invalid(`A ${DOCUMENT_FORMAT_META[format].label} document takes its text in content, not contentBase64.`);
    if (body.content === undefined) throw invalid("Pass the document's text in content.");
    return new TextEncoder().encode(body.content);
  }
  if (body.content !== undefined) throw invalid(`A ${format} document takes its bytes in contentBase64.`);
  if (!body.contentBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.contentBase64.replace(/\s/g, ""))) throw invalid("contentBase64 must be the file's bytes as base64.");
  const bytes = new Uint8Array(Buffer.from(body.contentBase64, "base64"));
  if (bytes.length === 0) throw invalid("The document is empty.");
  if (bytes.length > LIMITS.documentBytes) throw invalid(`Files are at most ${LIMITS.documentBytes / 1_000_000} MB.`);
  return bytes;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function findDocumentRow(ctx: Ctx, documentId: string): Promise<DocumentRow> {
  const [row] = await ctx.db.select().from(documents).where(tenantRow(ctx, documents, documentId));
  if (!row) throw notFound("document", documentId);
  return row;
}

/** What callers see of a row: everything but the tenant, the search vector and where the bytes live. */
function withoutStorage(row: DocumentRow): Document {
  const document: Partial<DocumentRow> = { ...row };
  delete document.tenantId;
  delete document.search;
  delete document.storageKey;
  return document as Document;
}

/** Agents edit and remove only what they wrote, unless it is a person's; people may change any. */
function assertMayChange(ctx: Ctx, row: DocumentRow, verb: string): void {
  if (ctx.actor.type === "agent" && row.createdByType === "agent" && row.createdById !== ctx.actor.id) {
    throw forbidden(`"${row.title}" belongs to ${row.createdByName}. Agents ${verb} only their own documents; attach a new version as your own document instead, or ask a person.`);
  }
}

/** Writes bytes to the store; outside a database store, takes them back if the transaction fails. */
async function storing<T>(ctx: Ctx, key: string, bytes: Uint8Array, format: DocumentFormat, run: (tx: Ctx) => Promise<T>): Promise<T> {
  return inTransaction(ctx, async (tx) => {
    const store = blobStore(tx);
    await store.put(key, bytes, DOCUMENT_FORMAT_META[format].contentType);
    try {
      return await run(tx);
    } catch (error) {
      if (store.driver !== "database") await store.delete([key]).catch(() => undefined);
      throw error;
    }
  });
}

/**
 * Attaches a document to a task or goal (or to neither, for the workspace): a draft to review, a
 * handoff note for the next agent, a report, a diagram. The bytes go to the blob store.
 */
export const attachDocument = service(AttachDocumentInput, async (ctx, input): Promise<Document> => {
  assertCan(ctx, "document:write");
  const { title, format, summary, taskId, goalId } = input;
  const bytes = bytesOf(format, input);
  if (taskId) await findTask(ctx, taskId);
  if (goalId) await assertGoalsExist(ctx, [goalId]);
  const id = newId("d");
  const key = documentKey(ctx.tenant.id, id, 1);

  return storing(ctx, key, bytes, format, async (tx) => {
    const [row] = await tx.db
      .insert(documents)
      .values({
        id,
        tenantId: tx.tenant.id,
        taskId: taskId ?? null,
        goalId: goalId ?? null,
        title,
        format,
        summary,
        size: bytes.length,
        sha256: sha256(bytes),
        storageKey: key,
        ...createdByFields(tx.actor),
        updatedByName: tx.actor.name,
      })
      .returning(documentColumns);
    await recordEvent(tx, {
      action: "document.attached",
      entityType: "document",
      entityId: id,
      summary: `attached "${title}"`,
      data: { taskId: taskId ?? null, goalId: goalId ?? null, format, version: 1 },
    });
    return row!;
  });
});

/** A document and what it holds, for agents picking up work and people reading it. */
export const getDocument = service(DocumentRefInput, async (ctx, { documentId }): Promise<DocumentWithContent> => {
  assertCan(ctx, "workspace:read");
  const row = await findDocumentRow(ctx, documentId);
  const bytes = await blobStore(ctx).get(row.storageKey);
  if (!bytes) throw notFound("document content", documentId);
  const document = withoutStorage(row);
  return isTextFormat(row.format) ? { document, content: new TextDecoder().decode(bytes) } : { document, contentBase64: Buffer.from(bytes).toString("base64") };
});

/** A document's raw bytes, for the download route. */
export async function documentBytes(ctx: Ctx, documentId: string): Promise<{ document: Document; bytes: Uint8Array }> {
  assertCan(ctx, "workspace:read");
  const row = await findDocumentRow(ctx, documentId);
  const bytes = await blobStore(ctx).get(row.storageKey);
  if (!bytes) throw notFound("document content", documentId);
  return { document: withoutStorage(row), bytes };
}

/** A document as lists show it, with the title of the task or goal it is attached to. */
export type DocumentListing = Document & { taskTitle: string | null; goalTitle: string | null };

export const listDocuments = service(ListDocumentsInput, async (ctx, { taskId, goalId, query, limit }): Promise<DocumentListing[]> => {
  assertCan(ctx, "workspace:read");
  const tsQuery = query ? prefixTsQuery(query) : null;
  return ctx.db
    .select({ ...documentColumns, taskTitle: tasks.title, goalTitle: goals.title })
    .from(documents)
    .leftJoin(tasks, and(eq(tasks.tenantId, documents.tenantId), eq(tasks.id, documents.taskId)))
    .leftJoin(goals, and(eq(goals.tenantId, documents.tenantId), eq(goals.id, documents.goalId)))
    .where(
      and(
        inTenant(ctx, documents),
        taskId ? eq(documents.taskId, taskId) : undefined,
        goalId ? eq(documents.goalId, goalId) : undefined,
        tsQuery ? matchesTsQuery(documents.search, tsQuery) : undefined,
      ),
    )
    .orderBy(desc(documents.updatedAt))
    .limit(limit);
});

/**
 * Edits a document: its text or bytes (a new version), its title or summary, or where it is
 * attached. With `expectedVersion`, an edit made on top of someone else's newer one is refused.
 */
export const updateDocument = service(UpdateDocumentInput, async (ctx, input): Promise<Document> => {
  assertCan(ctx, "document:write");
  const { documentId, expectedVersion, content, contentBase64, taskId, goalId, ...text } = input;
  const current = await findDocumentRow(ctx, documentId);
  assertMayChange(ctx, current, "edit");
  if (expectedVersion !== undefined && expectedVersion !== current.version) {
    throw conflict(`"${current.title}" changed since version ${expectedVersion} (it is at version ${current.version}). Read it again and apply your edit to the latest.`);
  }
  if (taskId) await findTask(ctx, taskId);
  if (goalId) await assertGoalsExist(ctx, [goalId]);
  const replacing = content !== undefined || contentBase64 !== undefined;
  const bytes = replacing ? bytesOf(current.format, { content, contentBase64 }) : null;
  const unchangedBody = bytes !== null && sha256(bytes) === current.sha256;

  const patch: Partial<typeof documents.$inferInsert> = {};
  if (text.title !== undefined && text.title !== current.title) patch.title = text.title;
  if (text.summary !== undefined && text.summary !== current.summary) patch.summary = text.summary;
  if (taskId !== undefined && taskId !== current.taskId) patch.taskId = taskId;
  if (goalId !== undefined && goalId !== current.goalId) patch.goalId = goalId;
  const changed = [...Object.keys(patch), ...(bytes && !unchangedBody ? ["content"] : [])];
  if (changed.length === 0) throw invalid("Nothing to update: the document already says that.");

  const version = current.version + 1;
  const key = bytes && !unchangedBody ? documentKey(ctx.tenant.id, current.id, version) : current.storageKey;
  const save = async (tx: Ctx) => {
    const [row] = await tx.db
      .update(documents)
      .set({
        ...patch,
        ...(bytes && !unchangedBody && { size: bytes.length, sha256: sha256(bytes), storageKey: key }),
        version,
        updatedByName: tx.actor.name,
        updatedAt: new Date(),
      })
      // The version check in the update itself, so two concurrent edits cannot both win.
      .where(and(tenantRow(tx, documents, current.id), eq(documents.version, current.version)))
      .returning(documentColumns);
    if (!row) throw conflict(`"${current.title}" was changed by someone else just now. Read it again and apply your edit to the latest.`);
    await recordEvent(tx, {
      action: "document.updated",
      entityType: "document",
      entityId: current.id,
      summary: `edited "${row.title}"`,
      data: { taskId: row.taskId, goalId: row.goalId, changed, version },
    });
    // The previous version's bytes go once the new version is committed.
    if (key !== current.storageKey) onCommit(tx, (db) => void blobStore({ ...tx, db }).delete([current.storageKey]).catch(() => undefined));
    return row;
  };
  return bytes && !unchangedBody ? storing(ctx, key, bytes, current.format, save) : inTransaction(ctx, save);
});

export const deleteDocument = service(DocumentRefInput, async (ctx, { documentId }): Promise<{ deleted: string }> => {
  assertCan(ctx, "document:write");
  const current = await findDocumentRow(ctx, documentId);
  assertMayChange(ctx, current, "delete");
  await inTransaction(ctx, async (tx) => {
    await tx.db.delete(documents).where(tenantRow(tx, documents, documentId));
    await recordEvent(tx, {
      action: "document.deleted",
      entityType: "document",
      entityId: documentId,
      summary: `deleted "${current.title}"`,
      data: { taskId: current.taskId, goalId: current.goalId },
    });
    const store = blobStore(tx);
    // A database store deletes in the transaction; an outside store once the row is gone for good.
    if (store.driver === "database") await store.delete([current.storageKey]);
    else onCommit(tx, () => void store.delete([current.storageKey]).catch(() => undefined));
  });
  return { deleted: documentId };
});
