import { routes } from "@/lib/routes";
import { appUrl } from "@/server/config";
import { AGENT_LINKS, PRODUCT, USE_CASE_LINKS } from "@/components/site/site-links";
import { loadPosts } from "@/server/blog";
import { DOC_SECTIONS, loadDocIndex } from "@/server/docs";

/** The docs for agents (llmstxt.org): what Phean is, and every docs page as a link with its summary. */
export async function GET() {
  const [index, posts] = await Promise.all([loadDocIndex(), loadPosts()]);
  const pages = new Map(index.map((page) => [page.slug, page]));
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
    `## Blog\n\n${posts.map((post) => `- [${post.title}](${base}${routes.blog(post.slug)}): ${post.description}`).join("\n")}`,
    `## Optional\n\n${[...PRODUCT.links, ...USE_CASE_LINKS.links]
      .map((link) => `- [${link.label}](${base}${link.href}): ${link.description}`)
      .join("\n")}\n- [Agents Phean works with](${base}${routes.docs("agents")}): ${AGENT_LINKS.links.map((link) => link.label).join(", ")}.`,
  ].join("\n\n");
  return new Response(`${body}\n`, { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
