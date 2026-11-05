/**
 * Documents: files agents and people attach to tasks and goals, such as a draft to review, a
 * handoff note, a report, or a diagram. Each has a format that says how Phean shows it. Client-safe.
 */
import type { Tone } from "./domain";

export const DOCUMENT_FORMATS = ["markdown", "text", "json", "csv", "yaml", "mermaid", "html", "pdf", "png", "jpeg", "gif", "webp"] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

interface FormatMeta {
  label: string;
  tone: Tone;
  contentType: string;
  extension: string;
  /** Binary formats travel as base64 and are shown or downloaded, never edited in Phean. */
  binary: boolean;
}

export const DOCUMENT_FORMAT_META: Record<DocumentFormat, FormatMeta> = {
  markdown: { label: "Markdown", tone: "info", contentType: "text/markdown; charset=utf-8", extension: "md", binary: false },
  text: { label: "Text", tone: "neutral", contentType: "text/plain; charset=utf-8", extension: "txt", binary: false },
  json: { label: "JSON", tone: "neutral", contentType: "application/json; charset=utf-8", extension: "json", binary: false },
  csv: { label: "CSV", tone: "neutral", contentType: "text/csv; charset=utf-8", extension: "csv", binary: false },
  yaml: { label: "YAML", tone: "neutral", contentType: "application/yaml; charset=utf-8", extension: "yaml", binary: false },
  mermaid: { label: "Diagram", tone: "info", contentType: "text/plain; charset=utf-8", extension: "mmd", binary: false },
  // Shown as source, never rendered: agent-written HTML must not run in people's browsers.
  html: { label: "HTML", tone: "neutral", contentType: "text/plain; charset=utf-8", extension: "html", binary: false },
  pdf: { label: "PDF", tone: "neutral", contentType: "application/pdf", extension: "pdf", binary: true },
  png: { label: "Image", tone: "neutral", contentType: "image/png", extension: "png", binary: true },
  jpeg: { label: "Image", tone: "neutral", contentType: "image/jpeg", extension: "jpg", binary: true },
  gif: { label: "Image", tone: "neutral", contentType: "image/gif", extension: "gif", binary: true },
  webp: { label: "Image", tone: "neutral", contentType: "image/webp", extension: "webp", binary: true },
};

export const TEXT_FORMATS = DOCUMENT_FORMATS.filter((format) => !DOCUMENT_FORMAT_META[format].binary);
export const IMAGE_FORMATS: readonly DocumentFormat[] = ["png", "jpeg", "gif", "webp"];

export const isTextFormat = (format: DocumentFormat) => !DOCUMENT_FORMAT_META[format].binary;

/** "draft-offer.md": a download name from the title and the format's extension. */
export function documentFileName(title: string, format: DocumentFormat): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "document";
  return `${base}.${DOCUMENT_FORMAT_META[format].extension}`;
}

/** "12 KB": a document's size for people. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What a task listing shows of each attached document. */
export interface DocumentRef {
  id: string;
  title: string;
  format: DocumentFormat;
}
