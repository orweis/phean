import { Bot, Brain, Scale } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { ASSISTANT_REQUESTS } from "./content";

/**
 * A phone's worth of personal assistants asking on one page: each request with its options and the
 * assistant's note, and a memory every assistant can recall. Sample data, labelled illustrative.
 */
export function AssistantInbox() {
  return (
    <figure className="product-frame mx-auto w-full max-w-sm rounded-[2.25rem] p-2.5 ring-1 ring-rule">
      <div className="rounded-[1.75rem] bg-paper">
        <div aria-hidden className="flex justify-center pt-2.5">
          <span className="h-1.5 w-16 rounded-full bg-fill" />
        </div>
        <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-2">
          <p className="font-display text-lg font-bold text-ink">Decisions</p>
          <span className="rounded-full bg-signal px-2 text-xs leading-5 font-bold text-on-signal">
            {ASSISTANT_REQUESTS.length}
            <span className="sr-only"> waiting on you</span>
          </span>
        </div>
        <ul aria-label="Your assistants are asking" className="space-y-2.5 px-3 pb-3">
          {ASSISTANT_REQUESTS.map(({ agent, ask, options, note }) => (
            <li key={agent} data-rise className="rounded-lg border border-rule bg-panel p-3.5">
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <Bot aria-hidden className="size-3.5" />
                {agent}
                <Badge tone="warning" className="ml-auto">
                  <Scale aria-hidden />
                  Decision
                </Badge>
              </p>
              <p className="mt-1.5 text-sm font-semibold text-ink">{ask}</p>
              <p className="mt-0.5 text-xs text-ink-2">{note}</p>
              <ul aria-label="Options" className="mt-2.5 flex flex-wrap gap-1.5">
                {options.map((option, index) => (
                  <li key={option} className="inline-flex h-7 items-center gap-1 rounded-full bg-fill px-3 text-xs font-semibold text-ink">
                    <kbd aria-hidden className="rounded-xs bg-panel/70 px-1 font-sans text-2xs text-ink-2">
                      {index + 1}
                    </kbd>
                    {option}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="mx-3 mb-3 flex items-start gap-2 rounded-lg bg-accent-tint px-3.5 py-3 text-xs text-accent-ink">
          <Brain aria-hidden className="mt-px size-4 shrink-0" />
          <span>
            <span className="font-semibold">Remembered for every assistant:</span> aisle seats, nothing before 7, Dana is vegetarian.
          </span>
        </p>
      </div>
      <figcaption className="px-4 pt-2.5 pb-1.5 text-center text-xs text-muted">Illustrative</figcaption>
    </figure>
  );
}
