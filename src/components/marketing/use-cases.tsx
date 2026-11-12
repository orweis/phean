"use client";

import { Bot, Check, Scale } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";

import { cx } from "@/lib/cx";

import { ActivityLog } from "./activity-log";
import { USE_CASES } from "./content";

/** Each team's hue, from the board's stations, so the tabs read as colour blocks the way a status board does. */
const HUES = ["bg-station-progress", "bg-station-inbox", "bg-station-done", "bg-signal"] as const;

/**
 * The teams Phean is for, as tabs (the WAI-ARIA tabs pattern: arrow keys move between them): what
 * the agents run, what reaches a person, and a sample day as the activity log shows it.
 */
export function UseCases() {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const current = USE_CASES[selected]!;

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (selected + step + USE_CASES.length) % USE_CASES.length;
    setSelected(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label="Who runs a fleet of agents" onKeyDown={onKeyDown} className="flex flex-wrap gap-2">
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
            className={cx(
              "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors duration-(--dur-micro)",
              selected === index ? "bg-ink text-paper" : "bg-panel text-ink-2 ring-1 ring-rule hover:text-ink hover:ring-edge",
            )}
          >
            <span aria-hidden className={cx("size-2.5 rounded-full", HUES[index % HUES.length])} />
            {useCase.label}
          </button>
        ))}
      </div>

      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected}`} className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div>
          <h3 className="display text-[clamp(1.75rem,3.2vw,2.5rem)] text-ink">{current.headline}</h3>
          <p className="mt-4 text-md text-ink-2">{current.pitch}</p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
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
                    <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-signal" />
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
