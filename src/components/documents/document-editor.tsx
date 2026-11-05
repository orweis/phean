"use client";

import { useState } from "react";

import { updateDocumentAction } from "@/app/w/[slug]/actions";
import { type DocumentFormat } from "@/lib/documents";
import { LIMITS } from "@/lib/domain";
import { routes } from "@/lib/routes";

import { ActionForm } from "../ui/action-form";
import { ButtonLink } from "../ui/button";
import { Field, Input, Textarea } from "../ui/field";
import { segment, SEGMENTED } from "../ui/segmented";
import { SubmitButton } from "../ui/submit-button";
import { MarkdownView } from "./markdown-view";
import { MermaidDiagram } from "./mermaid-diagram";

interface DocumentEditorProps {
  slug: string;
  document: { id: string; title: string; summary: string; format: DocumentFormat; version: number };
  content: string;
}

/**
 * Edits a text document: its title, summary and text, with a live preview for Markdown and
 * diagrams (side by side on wide screens, a Write and Preview switch on phones). Saving sends the
 * version it started from, so an agent's newer edit is never overwritten.
 */
export function DocumentEditor({ slug, document, content }: DocumentEditorProps) {
  const [text, setText] = useState(content);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const previews = document.format === "markdown" || document.format === "mermaid";
  const preview = document.format === "mermaid" ? <MermaidDiagram source={text} /> : <MarkdownView source={text} />;

  return (
    <ActionForm action={updateDocumentAction} workspace={slug} className="space-y-4">
      <input type="hidden" name="documentId" value={document.id} />
      <input type="hidden" name="expectedVersion" value={document.version} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" htmlFor="document-title">
          <Input id="document-title" name="title" required maxLength={LIMITS.documentTitle} defaultValue={document.title} />
        </Field>
        <Field label="Summary" htmlFor="document-summary" hint="What is in it and why, in a sentence.">
          <Input id="document-summary" name="summary" maxLength={LIMITS.documentSummary} defaultValue={document.summary} />
        </Field>
      </div>
      {previews && (
        <div role="tablist" aria-label="Editor view" className={`${SEGMENTED} w-fit lg:hidden`}>
          {(["write", "preview"] as const).map((option) => (
            <button key={option} type="button" role="tab" aria-selected={tab === option} className={segment(tab === option)} onClick={() => setTab(option)}>
              {option === "write" ? "Write" : "Preview"}
            </button>
          ))}
        </div>
      )}
      <div className={previews ? "grid gap-4 lg:grid-cols-2" : undefined}>
        <div className={previews && tab === "preview" ? "max-lg:hidden" : undefined}>
          <label htmlFor="document-content" className="sr-only">
            Text
          </label>
          <Textarea
            id="document-content"
            name="content"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={LIMITS.documentText}
            spellCheck={document.format === "markdown" || document.format === "text"}
            className="min-h-[28rem] font-mono text-xs leading-relaxed"
          />
        </div>
        {previews && (
          <section aria-label="Preview" className={`min-w-0 rounded-md border border-rule bg-panel p-4 ${tab === "write" ? "max-lg:hidden" : ""}`}>
            {preview}
          </section>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton variant="primary">Save</SubmitButton>
        <ButtonLink href={routes.document(slug, document.id)} variant="ghost">
          Cancel
        </ButtonLink>
        <span className="text-xs text-muted">Saving makes version {document.version + 1}.</span>
      </div>
    </ActionForm>
  );
}
