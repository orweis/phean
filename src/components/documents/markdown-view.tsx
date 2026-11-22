"use client";

import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import Markdown, { defaultUrlTransform, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

import { AgentMark, markForDocsPage } from "@/components/marketing/agent-logo";
import { webUrl } from "@/lib/agent-sessions";
import { headingId, textOf } from "@/lib/docs";

import { MermaidDiagram } from "./mermaid-diagram";

/** Whether links to an agent's docs page take its mark: on the docs site, inside a table cell (the Agents table). */
const AgentMarks = createContext({ enabled: false, inCell: false });

function Cell({ children, ...props }: ComponentProps<"td"> & ExtraProps) {
  const marks = useContext(AgentMarks);
  const attributes: ComponentProps<"td"> & ExtraProps = { ...props };
  delete attributes.node;
  return (
    <td {...attributes}>
      <AgentMarks.Provider value={{ ...marks, inCell: true }}>{children}</AgentMarks.Provider>
    </td>
  );
}

function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const { enabled, inCell } = useContext(AgentMarks);
  const web = href ? webUrl(href) : null;
  if (web) {
    return (
      <a href={web} target="_blank" rel="noopener noreferrer">
        {children}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  const agent = enabled && inCell && href ? markForDocsPage(href) : undefined;
  return agent ? (
    <a href={href} className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <AgentMark mark={agent.mark} name={agent.name} className="size-4 text-ink" />
      {children}
    </a>
  ) : (
    <a href={href}>{children}</a>
  );
}

/** Only images on Phean's own origin load inline. */
function isSameOriginImage(src: string): boolean {
  return /^\/(?![/\\])/.test(src);
}

/**
 * An image in agent-written Markdown. Loading one from another host would tell that host who read
 * the document and when (an agent that was prompt-injected could plant a tracking pixel), so an
 * outside image is shown as a link the reader can choose to open instead.
 */
function MarkdownImage({ src, alt }: { src?: string | Blob; alt?: string }) {
  if (typeof src !== "string" || !src) return alt ? <span>{alt}</span> : null;
  // eslint-disable-next-line @next/next/no-img-element -- agent content on Phean's origin, sized by the prose styles
  if (isSameOriginImage(src)) return <img src={src} alt={alt ?? ""} />;
  return (
    <span data-external-image>
      Image: <MarkdownLink href={src}>{alt || src}</MarkdownLink>
    </span>
  );
}

/**
 * Markdown as Phean shows it: GitHub-flavoured (tables, task lists, strikethrough), with ```mermaid
 * blocks drawn as diagrams. Raw HTML is not rendered and unsafe link schemes are dropped, since
 * agents write these documents; web links open in a new tab, and images from other hosts become links.
 */
export function MarkdownView({ source, headings = "shifted", agentMarks = false }: { source: string; headings?: "shifted" | "anchored"; agentMarks?: boolean }) {
  const anchored = headings === "anchored";
  return (
    <AgentMarks.Provider value={{ enabled: agentMarks, inCell: false }}>
      <div className="doc-prose" data-markdown>
        <Markdown
          remarkPlugins={[remarkGfm]}
          urlTransform={defaultUrlTransform}
          components={{
            // The page has its own h1 (the document's title), so an agent's document sits one level below it.
            // The docs site writes from `##` down, so its headings keep their level and take anchors for the outline.
            h1: ({ children }) => <h2 data-level="1">{children}</h2>,
            h2: ({ children }) =>
              anchored ? (
                <h2 id={headingId(textOf(children))} data-level="2">
                  {children}
                </h2>
              ) : (
                <h3 data-level="2">{children}</h3>
              ),
            h3: ({ children }) =>
              anchored ? (
                <h3 id={headingId(textOf(children))} data-level="3">
                  {children}
                </h3>
              ) : (
                <h4 data-level="3">{children}</h4>
              ),
            h4: ({ children }) => (anchored ? <h4 data-level="4">{children}</h4> : <h5 data-level="4">{children}</h5>),
            code({ className, children, ...props }) {
              const language = /language-(\w+)/.exec(className ?? "")?.[1];
              if (language === "mermaid") return <MermaidDiagram source={String(children).replace(/\n$/, "")} />;
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            },
            // A drawn diagram is not code, so it must not sit inside the <pre> the parser wraps it in.
            pre({ children, node }) {
              const first = node?.children[0];
              const isDiagram = first?.type === "element" && first.tagName === "code" && String(first.properties?.className ?? "").includes("language-mermaid");
              // A long line scrolls the block sideways, so a keyboard must be able to reach it too.
              return isDiagram ? <>{children}</> : <pre tabIndex={0}>{children}</pre>;
            },
            a: MarkdownLink,
            img: MarkdownImage,
            td: Cell,
          }}
        >
          {source}
        </Markdown>
      </div>
    </AgentMarks.Provider>
  );
}
