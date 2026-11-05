"use client";

import { Send } from "lucide-react";
import { useState } from "react";

import { answerInputAction, retractAnswerAction } from "@/app/w/[slug]/actions";
import type { InputRequest } from "@/lib/agent-sessions";
import { cx } from "@/lib/cx";

import { buttonClasses } from "./ui/button";
import { ActionForm } from "./ui/action-form";
import { SubmitButton } from "./ui/submit-button";

/**
 * A decision that takes several answers: the options are capsules with a tick box, and Send
 * delivers the ones ticked as one answer. Number keys tick and untick (see `DecisionKeys`), and
 * Enter on a ticked box sends. A capsule shows it is ticked by its box, its tint and a ring.
 */
export function MultipleChoice({ taskId, slug, request, title }: { taskId: string; slug: string; request: InputRequest; title: string }) {
  const [ticked, setTicked] = useState(0);
  return (
    <ActionForm
      action={answerInputAction}
      workspace={slug}
      notice={`Sent your picks to ${request.agentName}`}
      undo={{ action: retractAnswerAction, fields: { taskId, requestId: request.id }, done: `${request.agentName}'s question is open again.` }}
      className="flex flex-wrap items-center gap-x-1.5 gap-y-2"
    >
      <input type="hidden" name="taskId" value={taskId} />
      <fieldset
        className="contents"
        onChange={(event) => setTicked(event.currentTarget.querySelectorAll("input[name=choices]:checked").length)}
      >
        <legend className="sr-only">{`Pick any that apply for ${title}`}</legend>
        {request.options.map((option, index) => (
          <label
            key={option}
            className={cx(
              buttonClasses("secondary", "md"),
              "cursor-pointer select-none max-sm:w-full",
              "has-checked:bg-accent-tint has-checked:text-accent-ink has-checked:ring-2 has-checked:ring-accent has-checked:ring-inset",
              "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
            )}
          >
            <input
              type="checkbox"
              name="choices"
              value={index}
              data-option={index < 9 ? String(index + 1) : undefined}
              aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
              className="size-4 shrink-0 accent-accent"
            />
            {index < 9 && (
              <kbd aria-hidden className="hidden h-5 min-w-5 items-center justify-center rounded-xs bg-panel/70 px-1 font-sans text-2xs pointer-fine:inline-flex">
                {index + 1}
              </kbd>
            )}
            {option}
          </label>
        ))}
      </fieldset>
      <SubmitButton variant="tinted" disabled={ticked === 0} className="max-sm:w-full">
        <Send aria-hidden />
        {ticked > 1 ? `Send ${ticked} picks` : "Send pick"}
      </SubmitButton>
      <p className="w-full text-xs text-muted">Pick any that apply, then send.</p>
    </ActionForm>
  );
}
