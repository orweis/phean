import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownView } from "@/components/documents/markdown-view";

const render = (source: string) => renderToStaticMarkup(createElement(MarkdownView, { source }));

describe("MarkdownView with agent-written Markdown", () => {
  it("does not load images from other hosts, so readers are not tracked", () => {
    const html = render("Look: ![pixel](https://attacker.example/track.png?doc=1)");
    expect(html).not.toContain("<img");
    expect(html).toContain("data-external-image");
    expect(html).toContain('href="https://attacker.example/track.png?doc=1"');
    expect(html).toContain('rel="noopener noreferrer"');
    for (const sneaky of ["//attacker.example/a.png", "http://attacker.example/a.png", "HTTPS://attacker.example/a.png"]) {
      expect(render(`![x](${sneaky})`), sneaky).not.toContain("<img");
    }
  });

  it("still shows images on Phean's own origin", () => {
    expect(render("![Chart](/w/acme/documents/doc_1/file)")).toContain('<img src="/w/acme/documents/doc_1/file" alt="Chart"/>');
  });

  it("drops script and data URLs from images and links", () => {
    const html = render("[click](javascript:alert(1)) ![x](data:image/svg+xml;base64,PHN2Zz4=) ![y](javascript:alert(1))");
    expect(html).not.toMatch(/javascript:|data:image/);
    expect(html).not.toContain("<img");
  });

  it("never renders raw HTML an agent writes", () => {
    const html = render('<script>alert(1)</script><img src=x onerror="alert(1)"><iframe src="https://evil.example"></iframe>');
    // It shows as text at most: no element, and so no attribute that could run.
    expect(html).not.toMatch(/<(script|iframe|img)\b/i);
    expect(html).not.toMatch(/<[^>]+\sonerror=/i);
  });
});
