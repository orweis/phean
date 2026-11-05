import { FileText, Image as ImageIcon, Workflow } from "lucide-react";
import Link from "next/link";

import { cx } from "@/lib/cx";
import { IMAGE_FORMATS, type DocumentRef } from "@/lib/documents";
import { routes } from "@/lib/routes";

/** Chips shown on a task before the rest fold into a count. */
const SHOWN = 3;

const iconOf = (format: DocumentRef["format"]) => (format === "mermaid" ? Workflow : IMAGE_FORMATS.includes(format) ? ImageIcon : FileText);

/**
 * The documents on a task, each a chip that opens it in Phean. Unlike outside links they stay in
 * the app, so they carry a document icon and no arrow.
 */
export function DocumentChips({ documents, slug, className, max = SHOWN }: { documents: readonly DocumentRef[]; slug: string; className?: string; max?: number }) {
  if (documents.length === 0) return null;
  const shown = documents.slice(0, max);
  const more = documents.length - shown.length;
  return (
    <ul aria-label="Documents" className={cx("flex flex-wrap gap-1.5", className)}>
      {shown.map((document) => {
        const Icon = iconOf(document.format);
        return (
          <li key={document.id} className="min-w-0 max-w-full">
            <Link
              href={routes.document(slug, document.id)}
              data-document={document.id}
              title={document.title}
              className="relative inline-flex max-w-full items-center gap-1 rounded-sm bg-fill px-2 py-0.5 text-xs font-semibold text-ink-2 after:absolute after:inset-x-0 after:-inset-y-1 hover:bg-rule hover:text-ink"
            >
              <Icon className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{document.title}</span>
            </Link>
          </li>
        );
      })}
      {more > 0 && <li className="self-center text-xs text-muted">+{more} more</li>}
    </ul>
  );
}
