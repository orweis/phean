import { Bot, Check, MousePointer2, Scale, Send, Undo2 } from "lucide-react";

import { StationDot } from "@/components/task-marks";
import { ActorAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cx } from "@/lib/cx";

import { ProductFrame } from "./product-frame";

const OPTIONS = ["Meet the spring release", "What shipped in March", "Split the send 50/50"];
const PICKED = 1;

/** Picked, at rest: with motion off the picture shows the end of the story, option 2 chosen. */
const PICKED_AT_REST = "motion-reduce:bg-accent-tint motion-reduce:text-accent-ink motion-reduce:ring-2 motion-reduce:ring-accent motion-reduce:ring-inset";

/**
 * The hero's moving picture of the product, one 14-second loop (`data-demo`): an agent's decision
 * waits on the Decisions page, the cursor picks option 2, the answer is sent, the agent hears it in
 * the activity stream, and its card crosses the board to Done. With motion off it shows the end of
 * that story at rest. All sample data; it is a drawing of the app, not the app.
 */
export function HeroDemo() {
  return (
    <div data-demo className="relative mx-auto w-full max-w-2xl lg:max-w-none">
      <ProductFrame
        active="Decisions"
        counts={{ Decisions: 2 }}
        label="The Decisions page: a copywriter agent asks which subject line goes out on Monday, with three options and its recommendation."
        className="relative z-10"
      >
        <div className="p-4 sm:p-5">
          <div className="rounded-lg border border-wait/70 bg-panel">
            <div className="flex items-center justify-between gap-3 rounded-t-lg border-b border-wait/40 bg-wait-tint px-4 py-2.5">
              <p className="text-sm font-semibold text-ink">2 requests waiting on you</p>
              <span className="text-xs font-semibold text-wait-ink">From 2 agents</span>
            </div>
            <div className="space-y-2.5 px-4 py-3.5">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone="warning">
                  <Scale aria-hidden />
                  Decision
                </Badge>
                <span className="text-sm font-semibold text-ink">Launch email for the spring release</span>
              </p>
              <p className="flex items-center gap-1 text-xs text-muted">
                <Bot aria-hidden className="size-3" /> Copywriter agent asked 2 minutes ago in Claude
              </p>
              <p className="border-l-2 border-wait pl-3 text-sm text-ink">Which subject line goes out on Monday?</p>
              <ul className="flex flex-wrap gap-1.5">
                {OPTIONS.map((option, index) => (
                  <li
                    key={option}
                    data-pick={index === PICKED ? "" : undefined}
                    className={cx("relative inline-flex h-8 items-center gap-1.5 rounded-full bg-fill px-3 text-xs font-semibold text-ink", index === PICKED && PICKED_AT_REST)}
                  >
                    <kbd className="rounded-xs bg-panel/70 px-1 font-sans text-2xs text-ink-2">{index + 1}</kbd>
                    {option}
                    {/* The person's pointer, arriving to pick this option. */}
                    {index === PICKED && (
                      <MousePointer2 data-cursor aria-hidden className="pointer-events-none absolute top-4 right-3 size-5 fill-ink text-panel opacity-0 drop-shadow motion-reduce:hidden" />
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-ink-2">Option 2 read best with the pilot list, so I recommend it.</p>
            </div>
          </div>
          <p className="mt-3 flex items-center gap-2 rounded-md border border-rule bg-panel px-3 py-2 text-xs text-ink-2">
            <Badge tone="warning">Decision</Badge>
            <span className="truncate">Builder agent asked: cursor or offset pagination?</span>
          </p>
        </div>
      </ProductFrame>

      {/* The answer, said back in the status region as the app does, docked under the frame. */}
      <p
        data-toast
        aria-hidden
        className="glass-float absolute right-6 -bottom-5 z-30 flex items-center gap-3 rounded-full px-4 py-2 text-xs font-semibold whitespace-nowrap text-ink opacity-0 max-sm:hidden motion-reduce:hidden"
      >
        <Send className="size-3.5 text-accent-ink" />
        Sent to Copywriter agent
        <span className="inline-flex items-center gap-1 text-accent-ink">
          <Undo2 className="size-3.5" /> Undo
        </span>
      </p>

      {/* The work moving on its own, beside the decision. */}
      <div aria-hidden className="product-frame absolute -bottom-36 -left-10 z-20 hidden w-72 p-3.5 xl:block">
        <p className="mb-2 text-2xs font-semibold text-muted">Activity</p>
        <ul className="space-y-2.5">
          {[
            { who: "Triage agent", text: "Captured 9 tasks from new issues", status: "inbox" as const },
            { who: "Builder agent", text: "Claimed “Paginate the events API”", status: "in_progress" as const },
          ].map((item) => (
            <li key={item.text} className="flex items-start gap-2 text-xs">
              <ActorAvatar type="agent" className="mt-0 size-5" />
              <span className="min-w-0">
                <span className="block font-semibold text-ink">{item.who}</span>
                <span className="flex items-center gap-1.5 text-ink-2">
                  <StationDot status={item.status} />
                  {item.text}
                </span>
              </span>
            </li>
          ))}
          <li data-heard className="flex items-start gap-2 text-xs">
            <ActorAvatar type="agent" className="mt-0 size-5" />
            <span className="min-w-0">
              <span className="block font-semibold text-ink">Copywriter agent</span>
              <span className="flex items-center gap-1.5 text-ink-2">
                <StationDot status="done" />
                Heard your pick, scheduled the send
              </span>
            </span>
          </li>
        </ul>
      </div>

      <div aria-hidden className="product-frame absolute -top-16 -right-8 z-20 hidden w-80 p-3.5 lg:block">
        <p className="mb-2 flex items-center justify-between text-2xs font-semibold text-muted">
          Tasks
          <span className="inline-flex items-center gap-1.5 font-normal text-ink-2">
            <span className="size-1.5 rounded-full bg-station-done" /> 4 agents working
          </span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          {(["In progress", "Done"] as const).map((lane, index) => (
            <div key={lane}>
              <p className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold text-ink-2">
                <span className={cx("h-1 w-6 rounded-full", index ? "bg-station-done" : "bg-station-progress")} />
                {lane}
              </p>
              <div className="h-14 rounded-md border border-dashed border-rule" />
            </div>
          ))}
        </div>
        {/* The launch email's card, crossing to Done once the answer lands (and already there with motion off). */}
        <div
          data-travel
          className="absolute top-[3.65rem] left-3.5 w-[calc(50%-1.25rem)] rounded-md border border-rule bg-panel p-2 text-2xs shadow-raised motion-reduce:translate-x-[calc(100%+0.75rem)]"
        >
          <p className="font-semibold text-ink">Launch email</p>
          <p className="mt-0.5 flex items-center gap-1 text-muted">
            <Check className="size-3" /> Copywriter agent
          </p>
        </div>
      </div>
    </div>
  );
}
