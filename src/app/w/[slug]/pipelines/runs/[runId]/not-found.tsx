"use client";

import { Workflow } from "lucide-react";
import { useParams } from "next/navigation";

import { ButtonLink } from "@/components/ui/button";
import { routes } from "@/lib/routes";

/** An unknown run: say so, and lead back to the Pipelines tab. */
export default function RunNotFound() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <Workflow className="size-8 text-faint" aria-hidden />
      <h1 className="mt-4 text-xl font-bold text-ink">This run does not exist</h1>
      <p className="mt-1 max-w-sm text-sm text-ink-2">The link may be old, or the run may belong to another workspace.</p>
      <ButtonLink href={routes.pipelines(slug)} variant="primary" className="mt-6">
        Back to Pipelines
      </ButtonLink>
    </div>
  );
}
