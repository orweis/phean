import {
  Bot,
  Check,
  ChevronRight,
  CircleCheck,
  FileText,
  Globe,
  Handshake,
  LoaderCircle,
  Lock,
  Mail,
  MessageSquare,
  Plus,
  SendHorizontal,
  User,
  Webhook,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";

import { LogoMark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { cx } from "@/lib/cx";
import { DELEGATION_META, TASK_STATUS_META } from "@/lib/domain";

import { AgentMark } from "./agent-logo";
import { HANDOFF_END, shown, type HandoffWindow } from "./handoff-beats";
import { HandoffPlayer } from "./handoff-player";

/*
 * Agents passing one task between them, through Phean (the landing page's #handoffs), each in its own
 * app. The owner asks Grok Bot in a chat; Grok Bot drafts the email and hands the task to Claude in
 * Phean; Phean's webhook fires a Claude Code routine, whose session researches, adds three lines and
 * hands the task back; Grok Bot hears, sends the email and completes the task. Phean is the picture
 * both act on. Side by side from 1024px; under that the three are windows on a small desktop, each
 * opening and coming to the front as its part plays (`data-front`, `data-open`, set by the player).
 * Every piece is shown from one beat to another (`shown`). All sample data, with fictional companies
 * and `.example` addresses: a drawing of the products, not the products.
 */

const END = HANDOFF_END;
const TASK = "Follow up with Dana at Acme on Thursday's pricing call";
const GROK = { name: "Grok Bot", mark: "grok" } as const;
const CLAUDE = { name: "Claude", mark: "claude" } as const;
const ASK = "Send Dana at Acme the follow-up on Thursday's pricing call. Get Claude to add context from their latest news first.";
const NOTE_OUT = "Draft is attached. Add context and detail from recent research online: their funding, launches, hiring. Hand it back when done.";
const NOTE_BACK = "Added 3 points from their Series B news and Q3 launch; sources linked.";
const ADDED = [
  "Congratulations on the $40M Series B. Annual seat pooling suits a team that is growing.",
  "Acme Flow's Q3 launch looked great, and our approvals sync straight into it.",
  "With 12 sales roles open, each new rep is set up in minutes.",
];

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

/**
 * A conversation or a log that grows from the bottom: its lines take room only once they arrive
 * (`flow`), and the oldest slide up out of the top, as in the app.
 */
function Feed({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("handoff-feed flex min-h-0 flex-1 flex-col justify-end overflow-hidden", className)}>{children}</div>;
}

/** Where each window sits: side by side from 1024px, cascaded on a small desktop under it. */
const PLACES: Record<HandoffWindow, string> = {
  grok: "z-[1] max-lg:top-0 max-lg:left-0 max-lg:h-[400px] lg:h-[27rem]",
  claude: "z-[2] max-lg:top-10 max-lg:left-[5%] max-lg:h-[440px] lg:h-[27rem]",
  phean: "z-[3] max-lg:top-[92px] max-lg:left-[10%] max-lg:h-[488px] lg:col-span-2 lg:h-[29rem]",
};

/** An app's window on the stage: a title bar, then what the app shows. */
function Window({ app, bar, children }: { app: HandoffWindow; bar: ReactNode; children: ReactNode }) {
  return (
    <div data-window={app} className={cx("product-frame flex flex-col ring-1 ring-rule max-lg:absolute max-lg:w-[90%]", PLACES[app])}>
      <div className="flex shrink-0 items-center gap-2.5 border-b border-rule px-3.5 py-2">{bar}</div>
      {children}
    </div>
  );
}

function AppMark({ children }: { children: ReactNode }) {
  return <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fill text-ink ring-1 ring-rule ring-inset">{children}</span>;
}

/* --- Grok Bot: a chat with its person ---------------------------------------------------------------- */

function GrokFace() {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fill text-ink ring-1 ring-rule ring-inset">
      <AgentMark {...GROK} className="size-3.5" />
    </span>
  );
}

function Typing({ from, to, delay }: { from: number; to: number; delay: number }) {
  return (
    <div {...shown(from, to, { delay, flow: true })}>
      <div className="flex items-end gap-2 pt-3">
        <GrokFace />
        <span data-typing className="flex h-8 items-center gap-1 rounded-2xl rounded-bl-sm bg-fill px-3.5">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="size-1.5 rounded-full bg-muted" style={{ animationDelay: `${dot * 160}ms` }} />
          ))}
        </span>
      </div>
    </div>
  );
}

function FromGrok({ from, time, children, extra }: { from: number; time: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <div {...shown(from, END, { flow: true })}>
      <div className="flex items-end gap-2 pt-3 pr-6">
        <GrokFace />
        <div className="min-w-0">
          <p className="rounded-2xl rounded-bl-sm bg-fill px-3.5 py-2 text-sm text-ink">{children}</p>
          {extra}
          <p className="mt-0.5 pl-1 text-xs text-muted">{`Grok Bot · ${time}`}</p>
        </div>
      </div>
    </div>
  );
}

function GrokChat() {
  return (
    <Window
      app="grok"
      bar={
        <>
          <AppMark>
            <AgentMark {...GROK} className="size-4" />
          </AppMark>
          <span className="min-w-0 flex-1 text-sm">
            <span className="font-semibold text-ink">Grok Bot</span> <span className="text-xs text-muted">· Chat</span>
          </span>
        </>
      }
    >
      <Feed className="px-3.5 pb-3">
        <div {...shown(1, END, { flow: true })}>
          <div className="pt-3 pl-8 text-right">
            <p className="rounded-2xl rounded-br-sm bg-accent-tint px-3.5 py-2 text-left text-sm text-ink">{ASK}</p>
            <p className="mt-0.5 pr-1 text-xs text-muted">You · 9:40</p>
          </div>
        </div>
        <Typing from={1} to={2} delay={700} />
        <FromGrok from={2} time="9:40">
          Drafting… handing the research to Claude in Phean.
        </FromGrok>
        <div {...shown(11, END, { flow: true })}>
          <p className="mx-auto mt-3 flex w-fit items-center gap-1.5 rounded-full bg-fill px-3 py-1 text-xs text-ink-2">
            <Webhook aria-hidden className="size-3" />
            Phean · <span className="font-mono">handed_to_you</span>
          </p>
        </div>
        <Typing from={11} to={12} delay={500} />
        <FromGrok
          from={12}
          time="9:42"
          extra={
            <p className="mt-1.5 flex items-start gap-2 rounded-lg border border-rule bg-panel px-3 py-2 text-xs text-ink">
              <Mail aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted" />
              <span>
                <span className="block font-semibold">Following up on Thursday&apos;s pricing call</span>
                <span className="block text-muted">To dana@acme.example · 3 points added by Claude</span>
              </span>
            </p>
          }
        >
          Claude added 3 points from their news. Here&apos;s the final, sending now.
        </FromGrok>
        <FromGrok from={13} time="9:42">
          Sent to dana@acme.example ✓
        </FromGrok>
      </Feed>
      <div className="flex shrink-0 items-center gap-2 border-t border-rule px-3.5 py-2">
        <span className="flex-1 rounded-full bg-fill px-3.5 py-1.5 text-xs text-ink-2">Message Grok Bot</span>
        <SendHorizontal aria-hidden className="size-4 text-muted" />
      </div>
    </Window>
  );
}

/* --- Claude: a Claude Code session, started by a routine ------------------------------------------- */

/** A tool call, folded the way a session folds it: its name, what it was given, and a tick. */
function ToolCall({ tool, detail }: { tool: string; detail: string }) {
  return (
    <p className="flex items-start gap-1.5 rounded-md border border-rule bg-panel px-2.5 py-1.5 text-xs">
      <ChevronRight aria-hidden className="mt-0.5 size-3 shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <span className="font-mono font-semibold text-ink">{tool}</span> <span className="text-ink-2">{detail}</span>
      </span>
      <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-arrive-ink" />
    </p>
  );
}

/** One line of the session, arriving at its beat. */
function Line({ from, delay, children }: { from: number; delay?: number; children: ReactNode }) {
  return (
    <div {...shown(from, END, { delay, flow: true })}>
      <div className="pt-2">{children}</div>
    </div>
  );
}

const SOURCES = [
  { from: 6, delay: 700, site: "news.example", title: "Acme raises $40M Series B" },
  { from: 7, delay: 0, site: "acme.example/blog", title: "Introducing Acme Flow (Q3)" },
  { from: 7, delay: 500, site: "filings.example", title: "Acme Inc., Form D" },
];

function ClaudeSession() {
  return (
    <Window
      app="claude"
      bar={
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2.5">
            <AppMark>
              <AgentMark {...CLAUDE} className="size-4" />
            </AppMark>
            <span className="min-w-0 flex-1 text-sm font-semibold text-ink">Research for Grok Bot</span>
            <Slot className="shrink-0 justify-items-end">
              <span {...shown(0, 4, { swap: true })}>
                <Badge>Idle</Badge>
              </span>
              <span {...shown(4, 10, { swap: true })}>
                <Badge tone="info">
                  <LoaderCircle aria-hidden />
                  Running
                </Badge>
              </span>
              <span {...shown(10, END, { swap: true })}>
                <Badge tone="success">
                  <Check aria-hidden />
                  Succeeded
                </Badge>
              </span>
            </Slot>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1 font-semibold text-ink-2">
              <Zap aria-hidden className="size-3" />
              Routine
            </span>
            Triggered by API · Phean webhook
          </span>
        </span>
      }
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <p {...shown(0, 4, { swap: true })} className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-xs text-muted">
          Waits for its trigger: a POST from Phean to its Fire URL.
        </p>
        <Feed className="px-3.5 pb-3.5">
          {/* The run's first turn: what the Fire URL was sent, as the routine hands it over. */}
          <Line from={4}>
            <div className="rounded-lg bg-fill px-3 py-2 text-xs text-ink">
              <p className="font-mono text-ink-2">&lt;routine-fire-payload&gt;</p>
              <p className="mt-1">Phean: 1 change for Claude in Globex. Read the current state from Phean before you act.</p>
              <p className="mt-1">– Grok Bot is handing off “Follow up with Dana at Acme” to Claude [handed_to_you]</p>
            </div>
          </Line>
          <Line from={5}>
            <p className="text-sm text-ink">Grok Bot handed me the follow-up for Dana. Picking it up.</p>
          </Line>
          <Line from={5} delay={500}>
            <ToolCall tool="phean · claim_task" detail="Follow up with Dana at Acme" />
          </Line>
          <Line from={6}>
            <ToolCall tool="web_search" detail="Acme funding, launches, hiring" />
          </Line>
          {SOURCES.map(({ from, delay, site, title }) => (
            <Line key={site} from={from} delay={delay}>
              <p className="flex items-start gap-1.5 pl-5 text-xs text-ink-2">
                <Globe aria-hidden className="mt-0.5 size-3 shrink-0 text-muted" />
                <span>
                  <span className="font-semibold text-ink">{site}</span> · {title}
                </span>
              </p>
            </Line>
          ))}
          <Line from={8}>
            <ToolCall tool="phean · update_document" detail="Email to Dana, 3 lines added" />
          </Line>
          <Line from={8} delay={400}>
            <ul className="space-y-1 pl-5">
              {ADDED.map((line) => (
                <li key={line} className="flex gap-1.5 rounded-xs border-l-2 border-accent bg-accent-tint px-2 py-0.5 text-xs text-ink">
                  <Plus aria-hidden className="mt-0.5 size-3 shrink-0 text-accent-ink" />
                  {line}
                </li>
              ))}
            </ul>
          </Line>
          <Line from={9}>
            <ToolCall tool="phean · hand_off_task" detail="handBack: true" />
          </Line>
          <Line from={9} delay={500}>
            <p className="ml-5 border-l-2 border-rule pl-2.5 text-xs text-ink-2">“{NOTE_BACK}”</p>
          </Line>
          <Line from={10}>
            <p className="flex items-center gap-1.5 text-xs text-ink-2">
              <CircleCheck aria-hidden className="size-3.5 text-arrive-ink" />
              Handed back to Grok Bot. Run finished in 21s.
            </p>
          </Line>
        </Feed>
      </div>
    </Window>
  );
}

/* --- Phean: the task both act on ------------------------------------------------------------------- */

const ACTIVITY: { from: number; delay?: number; who: typeof GROK | typeof CLAUDE; text: string; time: string }[] = [
  { from: 3, who: GROK, text: "claimed it, from chat", time: "9:40" },
  { from: 3, delay: 400, who: GROK, text: "is handing it off to Claude", time: "9:40" },
  { from: 5, who: CLAUDE, text: "picked it up", time: "9:41" },
  { from: 8, who: CLAUDE, text: "updated “Email to Dana”", time: "9:41" },
  { from: 9, who: CLAUDE, text: "is handing it back to Grok Bot", time: "9:41" },
  { from: 11, who: GROK, text: "picked it up", time: "9:42" },
  { from: 14, who: GROK, text: "completed it", time: "9:42" },
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
    <figure {...shown(from, to, { swap: true })} className="self-start rounded-md border border-rule bg-fill/60 px-3 py-2 text-xs">
      <figcaption className="font-semibold text-ink-2">
        Handoff note <span className="font-normal text-muted">· {by}</span>
      </figcaption>
      <blockquote className="mt-0.5 text-ink">{children}</blockquote>
    </figure>
  );
}

function TaskCard() {
  return (
    <div {...shown(3)} className="relative shrink-0 rounded-lg border border-rule bg-panel p-3 sm:p-3.5">
      {/* Work in transit takes a dashed edge, as a board card does while it is handed off. */}
      <span {...shown(3, 5, { swap: true })} className="pointer-events-none absolute -inset-px rounded-lg border border-dashed border-line-inbox" />
      <span {...shown(9, 11, { swap: true })} className="pointer-events-none absolute -inset-px rounded-lg border border-dashed border-line-inbox" />
      <div className="flex flex-wrap items-center gap-1.5">
        <Slot>
          <span {...shown(3, 14, { swap: true })}>
            <Status status="in_progress" />
          </span>
          <span {...shown(14, END, { swap: true })}>
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
          <span {...shown(9, 11, { swap: true })}>
            <Handover state="handing_off" to="Grok Bot" />
          </span>
          <span {...shown(11, 12, { swap: true })}>
            <Handover state="picking_up" />
          </span>
        </Slot>
      </div>
      <p className="mt-2 text-sm font-semibold text-ink">{TASK}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <Slot>
          <Operator name="Grok Bot" from={3} to={5} />
          <Operator name="Claude" from={5} to={11} />
          <Operator name="Grok Bot" from={11} to={END} />
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
      <Slot className="mt-2.5">
        <Note by="Grok Bot, for Claude" from={3} to={6}>
          {NOTE_OUT}
        </Note>
        <p {...shown(6, 9, { swap: true })} className="flex items-center gap-1.5 self-start text-xs text-muted">
          <LoaderCircle aria-hidden className="size-3" />
          Claude is researching Acme
        </p>
        <Note by="Claude, back to Grok Bot" from={9} to={14}>
          {NOTE_BACK}
        </Note>
        <p {...shown(14, END, { swap: true })} className="flex items-start gap-1.5 self-start text-xs text-ink-2">
          <Check aria-hidden className="mt-0.5 size-3 shrink-0 text-arrive-ink" />
          Grok Bot: sent to dana@acme.example, with Claude&apos;s three points.
        </p>
      </Slot>
    </div>
  );
}

function Activity() {
  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 text-xs font-semibold text-muted">Activity</p>
      <Feed>
        {ACTIVITY.map(({ from, delay, who, text, time }) => (
          <div key={`${from}-${text}`} {...shown(from, END, { delay, flow: true })}>
            <p className="flex items-center gap-2 pt-1.5 text-xs">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-xs bg-fill text-ink ring-1 ring-rule ring-inset">
                <AgentMark {...who} className="size-3" />
              </span>
              <span className="min-w-0 flex-1 text-ink-2">
                <span className="font-semibold text-ink">{who.name}</span> {text}
              </span>
              <span className="text-muted">{time}</span>
            </p>
          </div>
        ))}
      </Feed>
    </div>
  );
}

const DRAFT_TOP = ["Hi Dana,", "Thanks again for Thursday's call. As promised, here is the pricing for 40 seats, with the annual discount we discussed."];
const DRAFT_END = "Would Tuesday suit for 20 minutes to settle the details?";

/** The email draft attached to the task, as it changes; shown where the windows sit side by side. */
function Draft() {
  return (
    <div {...shown(3)} className="flex flex-col rounded-lg border border-rule bg-panel max-lg:hidden">
      <div className="flex items-center gap-2 border-b border-rule px-3.5 py-2">
        <FileText aria-hidden className="size-3.5 text-muted" />
        <span className="flex-1 text-xs font-semibold text-ink">Email to Dana</span>
        <Slot className="justify-items-end">
          <span {...shown(3, 8, { swap: true })} className="text-xs text-muted">
            Revision 1 · Grok Bot
          </span>
          <span {...shown(8, 13, { swap: true })} className="text-xs text-muted">
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
        <div {...shown(3, 8, { swap: true })} className="space-y-2">
          {DRAFT_TOP.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p>{DRAFT_END}</p>
        </div>
        <div {...shown(8, END, { swap: true })} className="space-y-2">
          {DRAFT_TOP.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {/* Claude's lines, marked by a label and a plus as well as their wash. */}
          <div className="space-y-1">
            <p {...shown(8, END, { delay: 150 })} className="text-xs font-semibold text-accent-ink">
              Added by Claude
            </p>
            {ADDED.map((line, index) => (
              <p
                key={line}
                {...shown(8, END, { delay: 250 + index * 300 })}
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

function PheanApp() {
  return (
    <Window
      app="phean"
      bar={
        <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-fill px-3 py-1 text-xs text-ink-2">
          <Lock aria-hidden className="size-3 shrink-0" />
          <span>
            <span className="text-ink">phean.ai</span>/w/globex/tasks
          </span>
        </span>
      }
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-rule bg-glass px-3.5 py-2 text-xs">
        <LogoMark className="size-4" />
        <span className="font-semibold text-ink">Phean</span>
        <span className="text-muted">/</span>
        <span className="font-semibold text-ink-2">Globex</span>
        <span className="ml-auto rounded-full bg-accent-tint px-2.5 py-0.5 font-semibold text-accent-ink">Tasks</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 bg-paper p-3 sm:p-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col">
          <TaskCard />
          <Activity />
        </div>
        <Draft />
      </div>
    </Window>
  );
}

/* --- The story in words ---------------------------------------------------------------------------- */

const STEPS: { from: number; to: number; who: "you" | typeof GROK | typeof CLAUDE; title: string; body: string; state: ReactNode }[] = [
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
    body: "Phean's webhook (handed_to_you) fires a Claude Code routine; its session claims the task.",
    state: <Handover state="picking_up" />,
  },
  {
    from: 6,
    to: 9,
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
    from: 9,
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
      // On a phone the cascaded windows tell the story in one screen, so while they play the list is
      // for screen readers only; with reduced motion it is the storyboard, shown everywhere.
      className="mt-8 grid grid-cols-1 gap-x-5 gap-y-4 max-lg:motion-safe:sr-only sm:grid-cols-2 sm:gap-y-6 lg:grid-cols-3 xl:grid-cols-6 motion-reduce:mt-0"
    >
      {STEPS.map(({ from, to, who, title, body, state }, index) => (
        <li key={title} data-step className="relative border-t-2 border-rule pt-2.5 sm:pt-3">
          {/* The step playing now: a brand bar over the rule (the picture says the same in its own way). */}
          <span aria-hidden {...shown(from, to, { swap: true })} className="absolute inset-x-0 -top-0.5 h-0.5 rounded-full bg-accent motion-reduce:hidden" />
          <p className="flex items-center gap-2 text-xs font-semibold text-ink-2">
            <span className="figure text-md font-bold text-accent-ink">{index + 1}</span>
            {who === "you" ? <User aria-hidden className="size-3.5" /> : <AgentMark {...who} className="size-3.5" />}
            {who === "you" ? "You" : who.name}
          </p>
          <h3 className="mt-1 text-sm font-semibold text-ink sm:mt-1.5">{title}</h3>
          <p className="mt-0.5 text-xs leading-snug text-ink-2 sm:mt-1 sm:leading-normal">{body}</p>
          {/* On a phone the state sits beside the number, so each step stays a few lines tall. */}
          <div className="mt-2 max-sm:absolute max-sm:top-2 max-sm:right-0 max-sm:mt-0">{state}</div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The stage: Grok Bot's chat, Claude's routine session and Phean, then the story in six numbered
 * steps. With reduced motion only the steps show, a storyboard.
 */
export function HandoffRelay() {
  return (
    <HandoffPlayer
      picture={
        <div data-desk className="relative max-lg:h-[580px] lg:grid lg:grid-cols-2 lg:gap-5">
          <GrokChat />
          <ClaudeSession />
          <PheanApp />
        </div>
      }
      steps={<Steps />}
    />
  );
}
