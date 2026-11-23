import { Bot, Check, FileText, Handshake, LoaderCircle, MessageSquare, Plus, SendHorizontal, User, Webhook } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cx } from "@/lib/cx";
import { DELEGATION_META, TASK_STATUS_META } from "@/lib/domain";

import { AgentMark } from "./agent-logo";
import { HANDOFF_END, shown } from "./handoff-beats";
import { HandoffPlayer } from "./handoff-player";
import { ProductFrame } from "./product-frame";

/*
 * Agents passing one task between them, through Phean (the landing page's #handoffs). The owner asks
 * Grok Bot in a chat; Grok Bot drafts the email and hands the task to Claude; a Claude Code routine
 * wakes on Phean's webhook, researches, adds three lines and hands it back; Grok Bot sends it and
 * completes the task. Phean, in the middle, is the picture both act on. Every piece of the stage is
 * shown from one beat to another (`shown`), and the player moves the beat. All sample data, with
 * fictional companies and `.example` addresses: a drawing of the product, not the product.
 */

const END = HANDOFF_END;
const TASK = "Follow up with Dana at Acme on Thursday's pricing call";
const GROK = { name: "Grok Bot", mark: "grok" } as const;
const CLAUDE = { name: "Claude", mark: "claude" } as const;
const ASK = "Send Dana at Acme the follow-up on Thursday's pricing call. Get Claude to add context from their latest news first.";
const NOTE_OUT = "Draft is attached. Add context and detail from recent research online: their funding, launches, hiring. Hand it back when done.";
const NOTE_BACK = "Added 3 points from their Series B news and Q3 launch; sources linked.";

/** A handover badge, as `DelegationBadge` draws it: the handshake, the state's words and tone. */
function Handover({ state, to }: { state: keyof typeof DELEGATION_META; to?: string }) {
  const { label, tone } = DELEGATION_META[state];
  return (
    <Badge tone={tone}>
      <Handshake aria-hidden />
      {to ? `${label} to ${to}` : label}
    </Badge>
  );
}

/** A status badge from the tasks' own table. */
function Status({ status }: { status: "in_progress" | "done" }) {
  const { label, tone } = TASK_STATUS_META[status];
  return (
    <Badge tone={tone}>
      {status === "done" && <Check aria-hidden />}
      {label}
    </Badge>
  );
}

/** States that take each other's place, stacked in one cell so the row never moves. */
function Slot({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("grid *:col-start-1 *:row-start-1", className)}>{children}</div>;
}

/** An app's window on the page: a title bar with the agent's mark, and what it shows. */
function Window({
  title,
  detail,
  mark,
  status,
  children,
  className,
}: {
  title: string;
  detail: string;
  mark: ReactNode;
  status?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("product-frame flex flex-col ring-1 ring-rule", className)}>
      <div className="flex items-center gap-2.5 border-b border-rule px-4 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fill text-ink ring-1 ring-rule ring-inset">{mark}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{title}</span>
          <span className="block truncate text-2xs text-muted">{detail}</span>
        </span>
        {status}
      </div>
      {children}
    </div>
  );
}

/* --- Grok Bot: a chat with the owner ------------------------------------------------------------ */

function Typing({ from, to }: { from: number; to: number }) {
  return (
    <span {...shown(from, to, { delay: 500, swap: true })} className="flex items-end gap-2 self-start">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fill text-ink ring-1 ring-rule ring-inset">
        <AgentMark {...GROK} className="size-3.5" />
      </span>
      <span data-typing className="flex h-8 items-center gap-1 rounded-2xl rounded-bl-sm bg-fill px-3.5">
        {[0, 1, 2].map((dot) => (
          <span key={dot} className="size-1.5 rounded-full bg-muted" style={{ animationDelay: `${dot * 160}ms` }} />
        ))}
      </span>
    </span>
  );
}

function FromGrok({ from, time, children }: { from: number; time: string; children: ReactNode }) {
  return (
    <div {...shown(from, END, { swap: true })} className="flex items-end gap-2 self-start pr-8">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fill text-ink ring-1 ring-rule ring-inset">
        <AgentMark {...GROK} className="size-3.5" />
      </span>
      <span>
        <span className="block rounded-2xl rounded-bl-sm bg-fill px-3.5 py-2 text-sm text-ink">{children}</span>
        <span className="mt-0.5 block pl-1 text-2xs text-muted">{`Grok Bot · ${time}`}</span>
      </span>
    </div>
  );
}

function GrokChat() {
  return (
    <Window title="Grok Bot" detail="Chat" mark={<AgentMark {...GROK} className="size-4" />}>
      <div className="flex flex-1 flex-col gap-3 px-4 py-4">
        <div {...shown(1)} className="self-end pl-10 text-right">
          <p className="rounded-2xl rounded-br-sm bg-accent-tint px-3.5 py-2 text-left text-sm text-ink">{ASK}</p>
          <p className="mt-0.5 pr-1 text-2xs text-muted">You · 9:40</p>
        </div>
        <Slot className="self-stretch">
          <Typing from={1} to={2} />
          <FromGrok from={2} time="9:40">
            Drafting… handing the research to Claude in Phean.
          </FromGrok>
        </Slot>
        <p {...shown(11)} className="mx-auto flex items-center gap-1.5 rounded-full bg-fill px-3 py-1 text-2xs text-ink-2">
          <Webhook aria-hidden className="size-3" />
          Phean · <span className="font-mono">handed_to_you</span> · from Claude
        </p>
        <Slot className="self-stretch">
          <Typing from={11} to={12} />
          <FromGrok from={12} time="9:42">
            Claude added 3 points from their news. Here&apos;s the final, sending now.
          </FromGrok>
        </Slot>
        <FromGrok from={13} time="9:42">
          Sent to dana@acme.example ✓
        </FromGrok>
      </div>
      <div className="flex items-center gap-2 border-t border-rule px-4 py-2.5">
        <span className="flex-1 truncate rounded-full bg-fill px-3.5 py-1.5 text-xs text-muted">Message Grok Bot</span>
        <SendHorizontal aria-hidden className="size-4 text-muted" />
      </div>
    </Window>
  );
}

/* --- Claude: a scheduled routine's run log --------------------------------------------------------- */

const LOG: {
  from: number;
  delay?: number;
  time?: string;
  tick: string;
  tool?: string;
  text: string;
}[] = [
  {
    from: 4,
    time: "09:41:02",
    tick: "↓",
    tool: "webhook",
    text: "task.handed_off · handed_to_you",
  },
  {
    from: 5,
    time: "09:41:03",
    tick: "✓",
    tool: "claim_task",
    text: "“Follow up with Dana at Acme”",
  },
  {
    from: 6,
    time: "09:41:05",
    tick: "⌕",
    tool: "web_search",
    text: "Acme funding, launches, hiring",
  },
  {
    from: 6,
    delay: 700,
    tick: "↳",
    text: "news.example · Acme raises $40M Series B",
  },
  {
    from: 7,
    tick: "↳",
    text: "acme.example/blog · Introducing Acme Flow (Q3)",
  },
  { from: 8, tick: "↳", text: "filings.example · Acme Inc., Form D" },
  {
    from: 9,
    time: "09:41:19",
    tick: "✓",
    tool: "update_document",
    text: "Email to Dana · +3 lines",
  },
  {
    from: 10,
    time: "09:41:22",
    tick: "✓",
    tool: "hand_off_task",
    text: "handBack: true",
  },
  { from: 10, delay: 600, tick: "↳", text: `note: “${NOTE_BACK}”` },
  { from: 11, time: "09:41:23", tick: "■", text: "Run finished · 21s" },
];

function ClaudeRoutine() {
  return (
    <Window
      title="Claude · scheduled routine"
      detail="Research for Grok Bot · wakes on Phean webhooks"
      mark={<AgentMark {...CLAUDE} className="size-4" />}
      status={
        <Slot className="justify-items-end">
          <span {...shown(0, 4, { swap: true })}>
            <Badge>Waiting</Badge>
          </span>
          <span {...shown(4, 11, { swap: true })}>
            <Badge tone="info">
              <LoaderCircle aria-hidden />
              Running
            </Badge>
          </span>
          <span {...shown(11, END, { swap: true })}>
            <Badge tone="success">
              <Check aria-hidden />
              Finished
            </Badge>
          </span>
        </Slot>
      }
    >
      <div className="flex-1 bg-dusk px-4 py-3.5 font-mono text-xs leading-5 text-dusk-ink">
        <p className="text-dusk-muted">$ routine listen --phean handed_to_you</p>
        <ul className="mt-1.5">
          {LOG.map(({ from, delay, time, tick, tool, text }) => (
            <li
              key={text}
              {...shown(from, END, { delay })}
              className="grid grid-cols-[4.5rem_1rem_minmax(0,1fr)] gap-x-1.5 max-sm:grid-cols-[1rem_minmax(0,1fr)]"
            >
              <span className="text-dusk-muted max-sm:hidden">{time}</span>
              <span aria-hidden className={cx(tick === "↳" ? "text-dusk-muted" : "text-dusk-hill")}>
                {tick}
              </span>
              <span className={cx("wrap-anywhere", !tool && "text-dusk-muted")}>
                {tool && <span className="font-semibold">{tool} </span>}
                {text}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Window>
  );
}

/* --- Phean: the task both agents act on --------------------------------------------------------- */

const ACTIVITY: {
  from: number;
  who: typeof GROK | typeof CLAUDE;
  text: string;
  time: string;
}[] = [
  { from: 2, who: GROK, text: "claimed it, from chat", time: "9:40" },
  { from: 3, who: GROK, text: "is handing it off to Claude", time: "9:40" },
  { from: 5, who: CLAUDE, text: "picked it up", time: "9:41" },
  { from: 9, who: CLAUDE, text: "updated “Email to Dana”", time: "9:41" },
  {
    from: 10,
    who: CLAUDE,
    text: "is handing it back to Grok Bot",
    time: "9:41",
  },
  { from: 12, who: GROK, text: "picked it up", time: "9:42" },
  { from: 13, who: GROK, text: "completed it", time: "9:42" },
];

function Operator({ name, from, to }: { name: string; from: number; to: number }) {
  return (
    <span {...shown(from, to, { swap: true })} className="inline-flex items-center gap-1">
      <Bot aria-hidden className="size-3" />
      Operator: {name}
    </span>
  );
}

function Note({ by, from, to, children }: { by: string; from: number; to: number; children: ReactNode }) {
  return (
    <figure {...shown(from, to, { swap: true })} className="rounded-md border border-rule bg-fill/60 px-3 py-2 text-xs">
      <figcaption className="font-semibold text-ink-2">
        Handoff note <span className="font-normal text-muted">· {by}</span>
      </figcaption>
      <blockquote className="mt-0.5 text-ink">{children}</blockquote>
    </figure>
  );
}

function TaskCard() {
  return (
    <div {...shown(2)} className="relative rounded-lg border border-rule bg-panel p-3.5">
      {/* Work in transit takes a dashed edge, as a board card does while it is handed off. */}
      <span {...shown(3, 5, { swap: true })} className="pointer-events-none absolute -inset-px rounded-lg border border-dashed border-line-inbox" />
      <span {...shown(10, 12, { swap: true })} className="pointer-events-none absolute -inset-px rounded-lg border border-dashed border-line-inbox" />
      <div className="flex items-center gap-2">
        <Slot>
          <span {...shown(2, 13, { swap: true })}>
            <Status status="in_progress" />
          </span>
          <span {...shown(13, END, { swap: true })}>
            <Status status="done" />
          </span>
        </Slot>
        <Slot className="min-w-0">
          <span {...shown(3, 5, { swap: true })}>
            <Handover state="handing_off" to="Claude" />
          </span>
          <span {...shown(5, 6, { swap: true })}>
            <Handover state="picking_up" />
          </span>
          <span {...shown(10, 12, { swap: true })}>
            <Handover state="handing_off" to="Grok Bot" />
          </span>
          <span {...shown(12, 13, { swap: true })}>
            <Handover state="picking_up" />
          </span>
        </Slot>
      </div>
      <p className="mt-2 text-sm font-semibold text-ink">{TASK}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <Slot>
          <Operator name="Grok Bot" from={2} to={5} />
          <Operator name="Claude" from={5} to={12} />
          <Operator name="Grok Bot" from={12} to={END} />
        </Slot>
        <span className="inline-flex items-center gap-1">
          <MessageSquare aria-hidden className="size-3" />
          From chat
        </span>
        <span className="inline-flex items-center gap-1">
          <FileText aria-hidden className="size-3" />
          Email to Dana
        </span>
      </div>
      <Slot className="mt-3">
        <Note by="Grok Bot, for Claude" from={3} to={6}>
          {NOTE_OUT}
        </Note>
        <p {...shown(6, 10, { swap: true })} className="flex items-center gap-1.5 self-start text-xs text-muted">
          <LoaderCircle aria-hidden className="size-3" />
          Claude is researching Acme
        </p>
        <Note by="Claude, back to Grok Bot" from={10} to={13}>
          {NOTE_BACK}
        </Note>
        <p {...shown(13, END, { swap: true })} className="flex items-start gap-1.5 self-start text-xs text-ink-2">
          <Check aria-hidden className="mt-0.5 size-3 shrink-0 text-arrive-ink" />
          Grok Bot: sent to dana@acme.example, with Claude&apos;s three points.
        </p>
      </Slot>
    </div>
  );
}

function Activity() {
  return (
    <div className="mt-4">
      <p className="mb-1.5 text-2xs font-semibold text-muted">Activity</p>
      <ul className="space-y-1">
        {ACTIVITY.map(({ from, who, text, time }) => (
          <li key={`${from}-${text}`} {...shown(from)} className="flex items-center gap-2 text-xs">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-xs bg-fill text-ink ring-1 ring-rule ring-inset">
              <AgentMark {...who} className="size-3" />
            </span>
            <span className="min-w-0 flex-1 truncate text-ink-2">
              <span className="font-semibold text-ink">{who.name}</span> {text}
            </span>
            <span className="text-2xs text-muted">{time}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DRAFT_TOP = ["Hi Dana,", "Thanks again for Thursday's call. As promised, here is the pricing for 40 seats, with the annual discount we discussed."];
const DRAFT_ADDED = [
  "Congratulations on the $40M Series B. Annual seat pooling suits a team that is growing.",
  "Acme Flow's Q3 launch looked great, and our approvals sync straight into it.",
  "With 12 sales roles open, each new rep is set up in minutes.",
];
const DRAFT_END = "Would Tuesday suit for 20 minutes to settle the details?";

function Draft() {
  return (
    <div {...shown(2)} className="flex flex-col rounded-lg border border-rule bg-panel">
      <div className="flex items-center gap-2 border-b border-rule px-3.5 py-2">
        <FileText aria-hidden className="size-3.5 text-muted" />
        <span className="flex-1 truncate text-xs font-semibold text-ink">Email to Dana</span>
        <Slot className="justify-items-end">
          <span {...shown(2, 9, { swap: true })} className="text-2xs text-muted">
            Revision 1 · Grok Bot
          </span>
          <span {...shown(9, 13, { swap: true })} className="text-2xs text-muted">
            Revision 2 · Claude
          </span>
          <span {...shown(13, END, { swap: true })}>
            <Badge tone="success">
              <SendHorizontal aria-hidden />
              Sent
            </Badge>
          </span>
        </Slot>
      </div>
      <div className="space-y-0.5 border-b border-rule px-3.5 py-2 text-xs">
        <p className="text-muted">
          To <span className="text-ink">dana@acme.example</span>
        </p>
        <p className="text-muted">
          Subject <span className="text-ink">Following up on Thursday&apos;s pricing call</span>
        </p>
      </div>
      <Slot className="px-3.5 py-3 text-xs leading-5 text-ink">
        <div {...shown(2, 9, { swap: true })} className="space-y-2">
          {DRAFT_TOP.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p>{DRAFT_END}</p>
        </div>
        <div {...shown(9, END, { swap: true })} className="space-y-2">
          {DRAFT_TOP.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {/* Claude's lines, marked by a label and a plus as well as their wash. */}
          <div className="space-y-1">
            <p {...shown(9, END, { delay: 150 })} className="text-2xs font-semibold text-accent-ink">
              Added by Claude
            </p>
            {DRAFT_ADDED.map((line, index) => (
              <p
                key={line}
                {...shown(9, END, { delay: 250 + index * 300 })}
                className="flex gap-1.5 rounded-xs border-l-2 border-accent bg-accent-tint px-2 py-1"
              >
                <Plus aria-hidden className="mt-0.5 size-3.5 shrink-0 text-accent-ink" />
                <span>{line}</span>
              </p>
            ))}
          </div>
          <p>{DRAFT_END}</p>
        </div>
      </Slot>
    </div>
  );
}

function PheanTask() {
  return (
    <ProductFrame
      active="Tasks"
      label="Phean's task, shared by both agents: its operator, its handover, its note and its activity."
      className="ring-1 ring-rule"
    >
      <div className="grid grid-cols-1 gap-4 p-4 sm:p-5 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div>
          <TaskCard />
          <Activity />
        </div>
        <Draft />
      </div>
    </ProductFrame>
  );
}

/* --- The story in words ---------------------------------------------------------------------------- */

const STEPS: {
  from: number;
  to: number;
  who: "you" | typeof GROK | typeof CLAUDE;
  title: string;
  body: string;
  state: ReactNode;
}[] = [
  {
    from: 1,
    to: 3,
    who: "you",
    title: "You ask Grok Bot",
    body: `In a chat: “${ASK}”`,
    state: (
      <Badge>
        <MessageSquare aria-hidden />
        Chat
      </Badge>
    ),
  },
  {
    from: 3,
    to: 4,
    who: GROK,
    title: "Grok Bot drafts and hands off",
    body: `It attaches the draft and hands the task to Claude in Phean: “${NOTE_OUT}”`,
    state: <Handover state="handing_off" to="Claude" />,
  },
  {
    from: 4,
    to: 6,
    who: CLAUDE,
    title: "Claude's routine picks it up",
    body: "Phean's webhook (handed_to_you) wakes a scheduled Claude routine, which claims the task.",
    state: <Handover state="picking_up" />,
  },
  {
    from: 6,
    to: 10,
    who: CLAUDE,
    title: "Claude researches and adds",
    body: "It reads a news story, Acme's blog and a filing, and adds three lines to the draft.",
    state: (
      <span className="inline-flex items-center gap-1 text-xs text-muted">
        <Bot aria-hidden className="size-3" />
        Operator: Claude
      </span>
    ),
  },
  {
    from: 10,
    to: 11,
    who: CLAUDE,
    title: "Claude hands it back",
    body: `“Handed back to Grok Bot: ${NOTE_BACK.charAt(0).toLowerCase()}${NOTE_BACK.slice(1)}”`,
    state: <Handover state="handing_off" to="Grok Bot" />,
  },
  {
    from: 11,
    to: END,
    who: GROK,
    title: "Grok Bot sends it and finishes",
    body: "Told by its own handed_to_you, it reviews the draft, sends it to dana@acme.example and completes the task.",
    state: <Status status="done" />,
  },
];

function Steps() {
  return (
    <ol
      aria-label="The handoff, step by step"
      className="mt-8 grid grid-cols-1 gap-x-5 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 motion-reduce:mt-0"
    >
      {STEPS.map(({ from, to, who, title, body, state }, index) => (
        <li key={title} data-step className="relative border-t-2 border-rule pt-3">
          {/* The step playing now: a brand bar over the rule (the picture says the same in its own way). */}
          <span aria-hidden {...shown(from, to, { swap: true })} className="absolute inset-x-0 -top-0.5 h-0.5 rounded-full bg-accent motion-reduce:hidden" />
          <p className="flex items-center gap-2 text-xs font-semibold text-ink-2">
            <span className="figure text-md font-bold text-accent-ink">{index + 1}</span>
            {who === "you" ? <User aria-hidden className="size-3.5" /> : <AgentMark {...who} className="size-3.5" />}
            {who === "you" ? "You" : who.name}
          </p>
          <h3 className="mt-1.5 text-sm font-semibold text-ink">{title}</h3>
          <p className="mt-1 text-xs text-ink-2">{body}</p>
          <div className="mt-2">{state}</div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The stage: Grok Bot's chat and Claude's routine side by side, each acting on Phean's task below
 * them, then the story in six numbered steps. With reduced motion only the steps show, a storyboard.
 */
export function HandoffRelay() {
  return (
    <HandoffPlayer
      picture={
        <div className="grid grid-cols-1 gap-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <GrokChat />
            <ClaudeRoutine />
          </div>
          <PheanTask />
        </div>
      }
      steps={<Steps />}
    />
  );
}
