import { isLinkableId, pathOf } from "@/lib/links";

/**
 * Adds an absolute `url` to everything in a tool's result that a person can open: each task, goal,
 * document, memory and request (by its id), and each activity entry (by the object it is about).
 * Agents paste these into chats and handoff notes, so a person lands on the exact thing.
 */
export function withUrls<T>(value: T, slug: string, absolute: (path: string) => string): T {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== "object" || node instanceof Date) return node;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) out[key] = visit(child);
    if (!("url" in out)) {
      const target = isLinkableId(out.id) ? out.id : isLinkableId(out.entityId) ? out.entityId : null;
      const path = target && pathOf(slug, target);
      if (path) out.url = absolute(path);
    }
    return out;
  };
  return visit(value) as T;
}
