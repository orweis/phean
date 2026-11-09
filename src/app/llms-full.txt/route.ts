import { loadDocIndex } from "@/server/docs";

/** Every docs page in reading order, as one Markdown file for agents that read docs whole. */
export async function GET() {
  const pages = await loadDocIndex();
  const body = pages.map((page) => `# ${page.title}\n\n> ${page.description}\n\n${page.body.trim()}`).join("\n\n---\n\n");
  return new Response(`${body}\n`, { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
