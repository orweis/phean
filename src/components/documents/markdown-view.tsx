"use client";

import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { webUrl } from "@/lib/agent-sessions";

import { MermaidDiagram } from "./mermaid-diagram";

/**
 * Markdown as Phean shows it: GitHub-flavoured (tables, task lists, strikethrough), with ```mermaid
 * blocks drawn as diagrams. Raw HTML is not rendered and unsafe link schemes are dropped, since
 * agents write these documents; web links open in a new tab.
 */
export function MarkdownView({ source }: { source: string }) {
  return (
    <div className="doc-prose" data-markdown>
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={defaultUrlTransform}
        components={{
          // The page has its own h1 (the document's title), so the document's headings sit one level below it.
          h1: ({ children }) => <h2 data-level="1">{children}</h2>,
          h2: ({ children }) => <h3 data-level="2">{children}</h3>,
          h3: ({ children }) => <h4 data-level="3">{children}</h4>,
          h4: ({ children }) => <h5 data-level="4">{children}</h5>,
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
            return isDiagram ? <>{children}</> : <pre>{children}</pre>;
          },
          a({ href, children }) {
            const web = href ? webUrl(href) : null;
            return web ? (
              <a href={web} target="_blank" rel="noopener noreferrer">
                {children}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <a href={href}>{children}</a>
            );
          },
        }}
      >
        {source}
      </Markdown>
    </div>
  );
}
