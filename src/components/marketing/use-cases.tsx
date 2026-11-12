"use client";

import { Bot, Check, Scale } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";

import { segment, SEGMENTED } from "@/components/ui/segmented";
import { cx } from "@/lib/cx";

import { ActivityLog } from "./activity-log";
import { USE_CASES } from "./content";

/**
 * The teams Phean is for, as tabs (the WAI-ARIA tabs pattern: arrow keys move between them): what
 * the agents run, what reaches a person, and a sample day as the activity log shows it.
 */
export function UseCases() {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const current = USE_CASES[selected]!;

  // Arrow keys move between tabs, Home and End jump to the ends (the APG tabs pattern).
  const onKeyDown = (event: KeyboardEvent) => {
    const last = USE_CASES.length - 1;
    const next = { ArrowRight: selected === last ? 0 : selected + 1, ArrowLeft: selected === 0 ? last : selected - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setSelected(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label="Who runs a fleet of agents" onKeyDown={onKeyDown} className={cx(SEGMENTED, "w-fit max-w-full flex-wrap")}>
        {USE_CASES.map((useCase, index) => (
          <button
            key={useCase.key}
            id={`${id}-tab-${index}`}
            role="tab"
            type="button"
            aria-selected={selected === index}
            aria-controls={`${id}-panel`}
            tabIndex={selected === index ? 0 : -1}
            onClick={() => setSelected(index)}
            className={segment(selected === index)}
          >
            {useCase.label}
          </button>
        ))}
      </div>

      <div id={`${id}-panel`} role="tabpanel" tabIndex={0} aria-labelledby={`${id}-tab-${selected}`} className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div>
          <h3 className="display text-[clamp(1.75rem,3.2vw,2.5rem)] text-ink">{current.headline}</h3>
          <p className="mt-4 text-md text-ink-2">{current.pitch}</p>
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                <Bot aria-hidden className="size-3.5" /> The agents run
              </p>
              <ul className="mt-2 space-y-1.5 text-sm text-ink">
                {current.agents.map((line) => (
                  <li key={line} className="flex gap-2">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-arrive-ink" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                <Scale aria-hidden className="size-3.5" /> You decide
              </p>
              <ul className="mt-2 space-y-1.5 text-sm text-ink">
                {current.decisions.map((line) => (
                  <li key={line} className="flex gap-2">
                    <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-wait" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div className="product-frame p-5">
          <p className="mb-2 flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-ink">A sample morning</span>
            <span className="text-muted">Illustrative</span>
          </p>
          <ActivityLog key={current.key} entries={current.story} label={`A sample morning for ${current.label.toLowerCase()}`} />
        </div>
      </div>
    </div>
  );
}
