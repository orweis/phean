import { Bot, MessageCircleQuestionMark, Scale } from "lucide-react";
import type { CSSProperties } from "react";

import { Badge } from "@/components/ui/badge";

/** Agents from four teams, and the request each is waiting on a person for. */
const FLEET = [
  { agent: "Copywriter agent", team: "Marketing", kind: "decision", ask: "Which subject line goes out?" },
  { agent: "Builder agent", team: "Engineering", kind: "decision", ask: "Cursor or offset pagination?" },
  { agent: "Finance clerk", team: "Finance", kind: "question", ask: "What is the PO number for Northwind?" },
  { agent: "Recruiting agent", team: "People", kind: "decision", ask: "Which candidates get interviews?" },
] as const;

/** The curves from each agent (at 12.5%, 37.5%, 62.5%, 87.5% of the height) to the inbox's middle. */
const PATHS = FLEET.map((_, index) => {
  const y = 12.5 + index * 25;
  return `M0 ${y} C 50 ${y}, 50 50, 100 50`;
});

/**
 * Many agents, one place to ask: requests from four teams' agents travel into a single Decisions
 * inbox. The lines and the travelling requests are decorative and loop (`data-demo`); the agents and
 * the inbox are a list a screen reader reads as it is.
 */
export function DecisionHub() {
  return (
    <div data-demo className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1.1fr)]">
      <ul aria-label="Agents from four teams" className="space-y-3">
        {FLEET.map(({ agent, team }) => (
          <li key={agent} className="flex items-center gap-3 rounded-lg bg-dusk-2/70 px-4 py-3 ring-1 ring-dusk-muted/20">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-dusk text-dusk-ink">
              <Bot aria-hidden className="size-4" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-dusk-ink">{agent}</span>
              <span className="block text-xs text-dusk-muted">{team}</span>
            </span>
          </li>
        ))}
      </ul>

      <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="hidden h-full min-h-72 w-full overflow-visible text-dusk-hill lg:block">
        {PATHS.map((d) => (
          <path key={d} d={d} data-flow fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" opacity="0.7" />
        ))}
        {PATHS.map((d, index) => (
          <circle key={`packet-${d}`} data-packet r="2.2" className="fill-signal" style={{ offsetPath: `path("${d}")`, "--beat": index * 0.25 } as CSSProperties} />
        ))}
      </svg>

      <div className="product-frame">
        <div className="flex items-center justify-between border-b border-rule bg-wait-tint px-4 py-3">
          <p className="text-sm font-semibold text-ink">Decisions</p>
          <span className="rounded-full bg-signal px-2 text-xs leading-5 font-bold text-on-signal">
            4<span className="sr-only"> waiting on you</span>
          </span>
        </div>
        <ul aria-label="Waiting on you" className="divide-y divide-rule">
          {FLEET.map(({ agent, kind, ask }) => (
            <li key={agent} className="px-4 py-3">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={kind === "decision" ? "warning" : "neutral"}>
                  {kind === "decision" ? <Scale aria-hidden /> : <MessageCircleQuestionMark aria-hidden />}
                  {kind === "decision" ? "Decision" : "Question"}
                </Badge>
                <span className="text-sm font-semibold text-ink">{ask}</span>
              </p>
              <p className="mt-1 text-xs text-muted">{agent} · options, context and a recommendation · resume its session</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
