import { DOCUMENT_FORMAT_META, IMAGE_FORMATS, type DocumentFormat } from "@/lib/documents";
import { routes } from "@/lib/routes";

import { ButtonLink } from "../ui/button";
import { MarkdownView } from "./markdown-view";
import { MermaidDiagram } from "./mermaid-diagram";

interface DocumentBodyProps {
  slug: string;
  document: { id: string; title: string; format: DocumentFormat };
  /** The text, for text formats; binary formats are read from the file route. */
  content?: string;
}

/** A document as its format reads best: Markdown rendered, a diagram drawn, data and HTML as source, images inline, PDFs embedded. */
export function DocumentBody({ slug, document, content }: DocumentBodyProps) {
  const file = routes.documentFile(slug, document.id);
  if (document.format === "markdown") return <MarkdownView source={content ?? ""} />;
  if (document.format === "mermaid") return <MermaidDiagram source={content ?? ""} />;
  if (IMAGE_FORMATS.includes(document.format)) {
    // eslint-disable-next-line @next/next/no-img-element -- served by Phean after an access check, not optimizable
    return <img src={file} alt={document.title} className="mx-auto max-h-[70vh] max-w-full rounded-md border border-rule" />;
  }
  if (document.format === "pdf") {
    return (
      <div className="space-y-3">
        <object data={file} type="application/pdf" aria-label={document.title} className="h-[70vh] w-full rounded-md border border-rule">
          <p className="p-4 text-sm text-ink-2">This browser does not show PDFs inline.</p>
        </object>
        <ButtonLink href={routes.documentFile(slug, document.id, true)} size="sm" variant="secondary" prefetch={false}>
          Download the PDF
        </ButtonLink>
      </div>
    );
  }
  return (
    <pre data-format={document.format} className="overflow-x-auto rounded-md bg-fill p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink">
      {content}
    </pre>
  );
}

export const formatLabel = (format: DocumentFormat) => DOCUMENT_FORMAT_META[format].label;
