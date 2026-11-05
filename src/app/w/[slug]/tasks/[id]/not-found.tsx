"use client";

import { ListTodo } from "lucide-react";
import { useParams } from "next/navigation";

import { ButtonLink } from "@/components/ui/button";
import { routes } from "@/lib/routes";

/** An unknown task: say so, and lead back to the board. */
export default function TaskNotFound() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <ListTodo className="size-8 text-faint" aria-hidden />
      <h1 className="mt-4 text-xl font-bold text-ink">This task does not exist</h1>
      <p className="mt-1 max-w-sm text-sm text-ink-2">The link may be old, or the task may belong to another workspace.</p>
      <ButtonLink href={routes.board(slug)} variant="primary" className="mt-6">
        Go to the board
      </ButtonLink>
    </div>
  );
}
