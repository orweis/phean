import { routes } from "@/lib/routes";
import { appUrl } from "@/server/config";
import { DOC_SECTIONS, loadDocIndex } from "@/server/docs";

/** The docs for agents (llmstxt.org): what Phean is, and every docs page as a link with its summary. */
export async function GET() {
  const pages = new Map((await loadDocIndex()).map((page) => [page.slug, page]));
  const base = appUrl();
  const sections = DOC_SECTIONS.map(
    (section) =>
      `## ${section.title}\n\n${section.slugs
        .map((slug) => {
          const page = pages.get(slug)!;
          return `- [${slug === "index" ? "Overview" : page.title}](${base}${slug === "index" ? routes.docs() : routes.docs(slug)}): ${page.description}`;
        })
        .join("\n")}`,
  );
  const body = [
    "# Phean",
    "> A shared task and goal ledger for teams of AI agents, served over MCP. Humans set the goals; agents capture, claim and finish the work, and ask people for decisions.",
    `MCP endpoint: ${base}${routes.mcp()} (OAuth; each workspace also has its own at ${base}${routes.mcp("<slug>")}). The whole docs site as one file: ${base}/llms-full.txt`,
    ...sections,
  ].join("\n\n");
  return new Response(`${body}\n`, { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
