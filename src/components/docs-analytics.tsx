"use client";

import { useEffect } from "react";

import { AnalyticsPage } from "@/components/analytics";
import { track } from "@/lib/analytics";
import { copiedBlockOf, setupClientOf, skillsIn } from "@/lib/docs";

/** After the loader's own effects (they run after a page's), so consent is known and the page_view goes first. */
function afterPageView(send: () => void): () => void {
  let inner = 0;
  const outer = window.setTimeout(() => {
    inner = window.setTimeout(send, 0);
  }, 0);
  return () => {
    window.clearTimeout(outer);
    window.clearTimeout(inner);
  };
}

/**
 * A docs page's analytics (docs/ANALYTICS.md, "Docs"): its slug and section on the page_view, the
 * client it sets up (or the client section a link opened), and what a reader copies out of a code
 * block. Copied text is classified here and never sent; only the block's kind, its fence's language
 * and the skills it installs are.
 */
export function DocsAnalytics({ slug, section }: { slug: string; section: string }) {
  useEffect(() => {
    const client = setupClientOf(slug);
    const sent = new Set<string>();
    const sendSection = () => {
      const anchor = decodeURIComponent(window.location.hash.slice(1));
      const fromSection = client ? undefined : setupClientOf(anchor);
      if (fromSection && !sent.has(anchor)) {
        sent.add(anchor);
        track("client_setup_view", { client: fromSection });
      }
    };
    const cancel = afterPageView(() => {
      if (client) track("client_setup_view", { client });
      sendSection();
    });
    window.addEventListener("hashchange", sendSection);
    return () => {
      cancel();
      window.removeEventListener("hashchange", sendSection);
    };
  }, [slug]);

  useEffect(() => {
    const onCopy = () => {
      const node = document.getSelection()?.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      const body = element?.closest("[data-docs-body]");
      if (!element || !body) return;
      const pre = element.closest("pre");
      const code = pre?.querySelector("code") ?? element.closest("code");
      if (!code || !body.contains(code)) return;
      const lang = /language-(\w+)/.exec(code.className)?.[1];
      const text = code.textContent ?? "";
      track("docs_copy", { doc_slug: slug, block: copiedBlockOf(text, lang, !pre), ...(lang ? { lang } : {}) });
      for (const skill of skillsIn(text)) track("skill_install_click", { skill });
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [slug]);

  return <AnalyticsPage doc_slug={slug} doc_section={section} />;
}
