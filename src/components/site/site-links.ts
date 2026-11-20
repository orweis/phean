import { AGENTS } from "@/components/marketing/agent-logo";
import { USE_CASES } from "@/components/marketing/content";
import { routes } from "@/lib/routes";

/*
 * The marketing site's map, in one place: the header's menus, the footer's columns, the sitemap and
 * llms.txt all read it, so every page links the same destinations with the same words. Each link
 * carries a short description for the menus (and for answer engines reading the HTML); labels are
 * the words a person would search for.
 */

export interface SiteLink {
  href: string;
  label: string;
  /** One line under the label in the header's menus. */
  description?: string;
  /** Opens elsewhere: a new tab, and an announcement for screen readers. */
  external?: boolean;
}

export interface SiteGroup {
  title: string;
  links: SiteLink[];
}

/** A use case's anchor on the landing page; the tabs there select the one the address names. */
export const anchorForUseCase = (key: string) => `use-case-${key}`;

export const GITHUB_URL = "https://github.com/orweis/phean";

export const PRODUCT: SiteGroup = {
  title: "Product",
  links: [
    { href: "/#flip", label: "Task management, flipped", description: "Agents write and finish the tasks; people make the calls." },
    { href: "/#decisions", label: "Decisions inbox", description: "Every question your agents ask, on one page, with a way back." },
    { href: "/#assistants", label: "For personal assistants", description: "One inbox for every “should I?” your assistants ask." },
    { href: "/#features", label: "Features", description: "Goals, claims, shared memory, the digest, webhooks and more." },
    { href: "/#get-started", label: "How to get started", description: "Connect your first agent over MCP in three steps." },
    { href: "/#name", label: "Why “Phean”", description: "Short for Sisyphean: work that is never finished." },
  ],
};

export const USE_CASE_LINKS: SiteGroup = {
  title: "Use cases",
  links: USE_CASES.map(({ key, label, headline }) => ({ href: `/#${anchorForUseCase(key)}`, label, description: headline })),
};

export const AGENT_LINKS: SiteGroup = {
  title: "Agents",
  links: [
    ...AGENTS.filter((agent) => agent.name !== "Dots").map(({ name, docs }) => ({
      href: routes.docs(docs),
      label: name === "ChatGPT" ? "ChatGPT and Dots" : name === "Claude" ? "Claude apps" : name,
      description: `Connect ${name === "ChatGPT" ? "ChatGPT or Dots" : name === "Claude" ? "the Claude apps" : name} to Phean over MCP.`,
    })),
    { href: routes.docs("your-own-bot"), label: "Your own bot", description: "Any MCP client or script, with a key or OAuth." },
  ],
};

export const DEVELOPER_LINKS: SiteGroup = {
  title: "Developers",
  links: [
    { href: routes.docs(), label: "Documentation", description: "What Phean is and how its agent loop works." },
    { href: routes.docs("getting-started"), label: "Getting started", description: "An account, a workspace and your first agent." },
    { href: routes.docs("mcp-reference"), label: "MCP reference", description: "Every tool and prompt an agent can call." },
    { href: routes.docs("webhooks"), label: "Webhooks", description: "Signed calls that tell a bot what changed." },
    { href: routes.docs("self-hosting"), label: "Self-hosting", description: "Deploy Phean on Vercel with Neon Postgres." },
    { href: routes.docs("security"), label: "Security", description: "Tenant isolation, roles, tokens and webhook safety." },
    { href: "/llms.txt", label: "llms.txt", description: "The docs, indexed for language models." },
  ],
};

export const RESOURCE_LINKS: SiteGroup = {
  title: "Resources",
  links: [
    { href: routes.blog(), label: "Blog", description: "Notes on running agents and personal assistants." },
    { href: routes.blogFeed(), label: "RSS feed" },
    { href: GITHUB_URL, label: "GitHub", description: "Phean is open source under the MIT license.", external: true },
    { href: routes.privacy(), label: "Privacy policy" },
  ],
};

/** The sections of the site the header marks as the one you are in. */
export type SiteSection = "home" | "docs" | "blog" | "legal";
