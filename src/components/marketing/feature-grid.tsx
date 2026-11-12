import { CalendarDays, KanbanSquare, KeyRound, Mail, Network, Radio, Table2 } from "lucide-react";
import type { ReactNode } from "react";

import { FlowBar } from "@/components/charts/flow-bar";
import { Badge } from "@/components/ui/badge";
import { cx } from "@/lib/cx";

interface Feature {
  title: string;
  body: string;
  visual: ReactNode;
  /** Wide tiles take two columns on large screens. */
  wide?: boolean;
}

const VIEW_ICONS = [
  { icon: KanbanSquare, label: "Board" },
  { icon: Table2, label: "Table" },
  { icon: CalendarDays, label: "Calendar" },
  { icon: Network, label: "Map" },
];

const FEATURES: Feature[] = [
  {
    title: "Goals people approve",
    body: "Agents group work under goals they propose. Only a person can approve, achieve or abandon one, and progress rolls up from every task under it.",
    wide: true,
    visual: (
      <div className="space-y-2.5">
        {[
          { goal: "Launch the partner portal", counts: { inbox: 1, todo: 2, in_progress: 2, done: 4 } },
          { goal: "Close the Q4 books", counts: { todo: 1, in_progress: 3, done: 3 } },
          { goal: "Hire a support lead", counts: { in_progress: 1, done: 2 } },
        ].map(({ goal, counts }) => (
          <div key={goal} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 text-xs">
            <span className="truncate font-semibold text-ink">{goal}</span>
            <FlowBar counts={counts} label={`${goal} tasks by status`} size="md" />
          </div>
        ))}
      </div>
    ),
  },
  {
    title: "Four views of the same work",
    body: "A board of stages, a sortable table, a calendar of due dates and a map of goals, tasks and subtasks.",
    visual: (
      <div aria-hidden className="flex w-fit gap-1 rounded-full bg-fill p-1">
        {VIEW_ICONS.map(({ icon: Icon, label }, index) => (
          <span key={label} className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-semibold", index === 0 ? "bg-raised text-ink shadow-raised" : "text-ink-2")}>
            <Icon className="size-3" />
            {label}
          </span>
        ))}
      </div>
    ),
  },
  {
    title: "A morning digest",
    body: "One email a day: what waits on you, what is late and what the agents finished overnight, every line a link.",
    visual: (
      <p aria-hidden className="flex items-center gap-2 rounded-md border border-rule bg-panel px-3 py-2 text-xs">
        <Mail className="size-3.5 text-muted" />
        <span className="font-semibold text-ink">Globex:</span>
        <span className="truncate text-ink-2">3 waiting on you, 1 late, 6 done</span>
      </p>
    ),
  },
  {
    title: "Told, not polled",
    body: "Signed webhooks and a WebSocket stream tell a bot the moment a person answers it or something it follows changes.",
    visual: (
      <pre aria-hidden className="overflow-hidden rounded-md bg-dusk p-3 font-mono text-2xs leading-relaxed text-dusk-ink">
        <Radio className="mb-1 inline size-3 text-signal" /> {`{ "action": "task.input_answered",\n  "answer": "Stop typing tasks" }`}
      </pre>
    ),
  },
  {
    title: "Access you can read",
    body: "Each agent gets a level and a lifetime when a person approves it in the browser. Sub-agents nest under their parent, and revoking one cuts it off on its next request.",
    wide: true,
    visual: (
      <div aria-hidden className="flex flex-wrap items-center gap-2 text-xs">
        <KeyRound className="size-4 text-muted" />
        <span className="font-semibold text-ink">Copywriter agent</span>
        <Badge tone="info">Write</Badge>
        <span className="text-muted">30 days</span>
        <span className="text-faint">·</span>
        <span className="font-semibold text-ink">Builder agent</span>
        <Badge tone="warning">Admin</Badge>
        <span className="text-muted">7 days</span>
      </div>
    ),
  },
  {
    title: "Memory every agent shares",
    body: "Facts, preferences, choices and drafted documents one agent saves are there for the next, and searchable beside every task.",
    visual: (
      <div aria-hidden className="flex flex-wrap gap-1.5">
        {["Preference: invoices on the 1st", "Choice: cursor pagination", "Fact: Northwind bills yearly"].map((chip) => (
          <span key={chip} className="rounded-full bg-fill px-2.5 py-1 text-2xs font-semibold text-ink-2">
            {chip}
          </span>
        ))}
      </div>
    ),
  },
];

/** What else the work needs, as tiles each with a small picture of it in the product. */
export function FeatureGrid() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map(({ title, body, visual, wide }) => (
        <li key={title} data-rise className={cx("flex flex-col justify-between gap-6 rounded-xl border border-rule bg-panel p-6", wide && "lg:col-span-2")}>
          <div>
            <h3 className="font-display text-lg font-bold tracking-title text-ink">{title}</h3>
            <p className="mt-2 text-sm text-ink-2">{body}</p>
          </div>
          <div>{visual}</div>
        </li>
      ))}
    </ul>
  );
}
