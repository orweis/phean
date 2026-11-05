"use client";

import { useEffect, useId, useState } from "react";

/**
 * Whether the page is in its dark appearance. Mermaid draws with concrete colours, so it needs the
 * resolved appearance: the person's choice from `<html data-appearance>`, or the device's under System.
 */
function isDark(): boolean {
  const chosen = document.documentElement.dataset.appearance;
  if (chosen === "dark") return true;
  if (chosen === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * A Mermaid diagram from its source, drawn in the browser. Mermaid loads only when a diagram is on
 * the page, and runs in strict mode, which sanitizes what it draws. If the source does not parse,
 * the source is shown with the reason, so a person can fix it.
 */
export function MermaidDiagram({ source }: { source: string }) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: isDark() ? "dark" : "neutral", fontFamily: "inherit" });
        const { svg: drawn } = await mermaid.render(id, source);
        if (!cancelled) {
          setSvg(drawn);
          setProblem(null);
        }
      } catch (error) {
        if (!cancelled) setProblem(error instanceof Error ? error.message : "The diagram could not be drawn.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, source]);

  if (problem) {
    return (
      <figure data-diagram="error" className="rounded-md border border-late/40 bg-late-tint p-3">
        <figcaption className="text-xs font-semibold text-late-ink">This diagram could not be drawn: {problem.split("\n")[0]}</figcaption>
        <pre className="mt-2 overflow-x-auto font-mono text-xs text-ink">{source}</pre>
      </figure>
    );
  }
  return (
    <figure data-diagram={svg ? "drawn" : "loading"} className="overflow-x-auto rounded-md border border-rule bg-panel p-3">
      {svg ? (
        // Mermaid's strict security level sanitizes the SVG it returns.
        <div role="img" aria-label="Diagram" className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <p className="py-6 text-center text-xs text-muted">Drawing the diagram…</p>
      )}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-ink-2 link">Diagram source</summary>
        <pre className="mt-1 overflow-x-auto font-mono text-ink-2">{source}</pre>
      </details>
    </figure>
  );
}
