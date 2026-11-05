"use client";

import { FileText } from "lucide-react";
import { useParams } from "next/navigation";

import { ButtonLink } from "@/components/ui/button";
import { routes } from "@/lib/routes";

/** An unknown or deleted document: say so, and lead back to the documents list. */
export default function DocumentNotFound() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <FileText className="size-8 text-faint" aria-hidden />
      <h1 className="mt-4 text-xl font-bold text-ink">This document does not exist or was deleted</h1>
      <p className="mt-1 max-w-sm text-sm text-ink-2">The link may be old, or the document may belong to another workspace.</p>
      <ButtonLink href={routes.documents(slug)} variant="primary" className="mt-6">
        All documents
      </ButtonLink>
    </div>
  );
}
