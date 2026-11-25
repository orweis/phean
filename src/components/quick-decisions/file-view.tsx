"use client";

import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { QuickItem } from "@/lib/quick-decisions";

import { buttonClasses } from "../ui/button";
import { BackLink } from "./context-view";
import type { QuickController } from "./controller";

/** One of the request's files, read on the server and drawn as its document page draws it. */
export interface QuickFile {
  id: string;
  title: string;
  /** "Markdown", "PDF": what kind of file it is. */
  kind: string;
  downloadHref: string;
  body: ReactNode;
}

/** Previous or next file: a link, or a disabled-looking placeholder at either end, so the pair keeps its place. */
function Step({ href, label, children }: { href: string | null; label: string; children: ReactNode }) {
  const look = buttonClasses("secondary", "touch");
  return href ? (
    <Link href={href} scroll={false} replace aria-label={label} className={look}>
      {children}
    </Link>
  ) : (
    <span role="link" aria-disabled="true" aria-label={label} className={look}>
      {children}
    </span>
  );
}

/**
 * A file of the request on screen: back to its list in one tap, its name and kind, previous and
 * next, the file itself as Phean shows documents (Markdown rendered, HTML as source, images and PDFs
 * from the file route), and a way back to the decision that stays in reach.
 */
export function FileView({ item, file, ctl }: { item: QuickItem; file: QuickFile; ctl: QuickController }) {
  const index = item.documents.findIndex((document) => document.id === file.id);
  const at = (offset: number) => {
    const other = item.documents[index + offset];
    return other ? ctl.href({ request: item.request.id, view: "file", file: other.id }) : null;
  };
  return (
    <section aria-labelledby="quick-file-title" data-quick-file={file.id} className="mx-auto w-full max-w-3xl pb-24">
      <div className="flex items-center justify-between gap-2">
        <BackLink href={ctl.href({ request: item.request.id, view: "context", tab: "files" })}>Files</BackLink>
        <div className="flex items-center gap-1.5">
          <Step href={at(-1)} label="Previous file">
            <ChevronLeft aria-hidden />
          </Step>
          <Step href={at(1)} label="Next file">
            <ChevronRight aria-hidden />
          </Step>
        </div>
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 id="quick-file-title" className="text-xl font-semibold wrap-anywhere text-ink">
            {file.title}
          </h1>
          <p className="mt-0.5 text-xs text-muted">
            {file.kind} · {index + 1} of {item.documents.length}
          </p>
        </div>
        <a href={file.downloadHref} className={buttonClasses("ghost", "sm")}>
          <Download aria-hidden />
          Download
        </a>
      </div>
      <div className="surface mt-4 rounded-lg border border-rule px-4 py-4 sm:px-5">{file.body}</div>
      <div className="fixed inset-x-4 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-xl justify-center">
        <Link href={ctl.href({ request: item.request.id })} scroll={false} className={buttonClasses("primary", "touch", "w-full sm:w-auto")}>
          Back to the decision
        </Link>
      </div>
    </section>
  );
}
