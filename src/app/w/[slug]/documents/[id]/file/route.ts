import { DOCUMENT_FORMAT_META, documentFileName } from "@/lib/documents";
import { requireWorkspace } from "@/server/auth/session";
import { isDomainError } from "@/server/domain/errors";
import { documentBytes } from "@/server/domain/documents";

/**
 * A document's bytes, for the viewer and for downloads. Access is checked here on every request,
 * so a blob is never reachable by a URL a browser holds. HTML and other text are served as plain
 * text, and a sandboxing policy keeps anything served from running scripts on Phean's origin.
 */
export async function GET(request: Request, context: RouteContext<"/w/[slug]/documents/[id]/file">) {
  const { slug, id } = await context.params;
  const { ctx } = await requireWorkspace(slug);
  try {
    const { document, bytes } = await documentBytes(ctx, id);
    const download = new URL(request.url).searchParams.get("download") === "1";
    const name = documentFileName(document.title, document.format);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": DOCUMENT_FORMAT_META[document.format].contentType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
        "Content-Length": String(bytes.length),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (isDomainError(error) && error.code === "not_found") return new Response("Not found", { status: 404 });
    throw error;
  }
}
