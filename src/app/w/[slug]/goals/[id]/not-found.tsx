"use client";

import { Target } from "lucide-react";
import { useParams } from "next/navigation";

import { ButtonLink } from "@/components/ui/button";
import { routes } from "@/lib/routes";

/** An unknown or removed goal: say so, and lead back to the overview, since trying again cannot help. */
export default function GoalNotFound() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <Target className="size-8 text-faint" aria-hidden />
      <h1 className="mt-4 text-xl font-bold text-ink">This goal does not exist or was removed</h1>
      <p className="mt-1 max-w-sm text-sm text-ink-2">The link may be old, or the goal may belong to another workspace.</p>
      <ButtonLink href={routes.workspace(slug)} variant="primary" className="mt-6">
        Back to the overview
      </ButtonLink>
    </div>
  );
}
