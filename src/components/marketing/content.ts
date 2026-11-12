import type { ActivityEntry } from "./activity-log";

/**
 * The marketing site's words that come in sets: the teams Phean is for and a sample day for each.
 * Every story is illustrative (no customer, figure or result is claimed), and the page says so.
 */

export interface UseCase {
  key: string;
  label: string;
  /** One line on who runs a fleet like this. */
  headline: string;
  pitch: string;
  /** What the agents do on their own. */
  agents: string[];
  /** What reaches a person, as decisions with options. */
  decisions: string[];
  story: ActivityEntry[];
}

export const USE_CASES: UseCase[] = [
  {
    key: "assistants",
    label: "Personal assistants",
    headline: "Every assistant you run, one inbox for “should I?”",
    pitch:
      "One assistant books the travel, one answers the email, one shops, one plans the week. Each asks you in its own app. With Phean they all report to one ledger and ask on one page, and what you told one of them, the others can recall.",
    agents: ["Turn promises in email and chat into tasks", "Book, buy, reply and schedule on their own", "Share what they learn about you in memory"],
    decisions: ["The 7:40 flight or the 9:15?", "Accept Dana's dinner on Thursday?", "Which gifts for Mom? Pick any"],
    story: [
      { time: "06:40", who: "Inbox assistant", type: "agent", station: "inbox", text: "Captured 3 things you promised in last night's email: the deck for Sam, the school form, the dentist." },
      {
        time: "07:05",
        who: "Travel assistant",
        type: "agent",
        station: "wait",
        text: "Asked: the 7:40 to Boston or the 9:15? It recommends the 9:15, so your 8:30 call stays put.",
        options: [{ label: "7:40" }, { label: "9:15", picked: true }],
      },
      { time: "07:06", who: "You", type: "user", station: "move", text: "Picked 9:15 on your phone, from the morning digest." },
      { time: "07:07", who: "Travel assistant", type: "agent", station: "done", text: "Booked it with an aisle seat, a preference it recalled from what you told the calendar assistant." },
      { time: "07:30", who: "Calendar assistant", type: "agent", station: "done", text: "Moved the dentist to Friday and closed the task." },
    ],
  },
  {
    key: "marketing",
    label: "Marketing teams",
    headline: "A content team of agents, one editor-in-chief.",
    pitch:
      "Agents draft the posts, size the audiences and schedule the sends. The brand calls, the budget and anything that goes out under your name come to you, with the drafts attached.",
    agents: ["Turn briefs and Slack threads into tasks", "Draft copy and variants, attached as documents", "Run tests and report what won"],
    decisions: ["Which headline goes live?", "Approve this week's paid budget", "Which channels announce the launch? Pick any"],
    story: [
      { time: "08:02", who: "Brief reader", type: "agent", station: "inbox", text: "Captured 5 tasks from Monday's campaign brief, each linked to its line in the doc." },
      { time: "08:30", who: "Copywriter agent", type: "agent", station: "move", text: "Claimed “Launch email” and attached three drafts." },
      {
        time: "09:14",
        who: "Copywriter agent",
        type: "agent",
        station: "wait",
        text: "Asked: which subject line goes out? It recommends B, which read best with the pilot list.",
        options: [{ label: "A: The spring update" }, { label: "B: Stop typing tasks", picked: true }, { label: "Split the send" }],
      },
      { time: "09:16", who: "You", type: "user", station: "move", text: "Picked B from the Decisions page, between two meetings." },
      { time: "09:17", who: "Copywriter agent", type: "agent", station: "done", text: "Heard the answer over its webhook, scheduled the send, and closed the task." },
    ],
  },
  {
    key: "software",
    label: "Software factories",
    headline: "Coding agents in parallel, without stepping on each other.",
    pitch:
      "Agents pick up issues, open pull requests and fix what CI finds. Claims keep two agents off the same task, and the calls a human must make (an API change, a migration, a release) wait for you in one queue instead of fifty chat windows.",
    agents: ["Turn issues and failing builds into tasks", "Claim work so no two agents collide", "Leave the PR and the session one click away"],
    decisions: ["Ship the migration tonight or after the freeze?", "Which of two designs for the new endpoint?", "Approve the release goal"],
    story: [
      { time: "10:05", who: "Triage agent", type: "agent", station: "inbox", text: "Captured 9 tasks from new issues; skipped 2 the review agent already had." },
      { time: "10:11", who: "Builder agent", type: "agent", station: "move", text: "Claimed “Paginate the events API”. A second builder was refused the same task and took the next." },
      {
        time: "11:40",
        who: "Builder agent",
        type: "agent",
        station: "wait",
        text: "Asked: cursor or offset pagination? It recommends cursors; the PR and its session are linked.",
        options: [{ label: "Cursor", picked: true }, { label: "Offset" }],
      },
      { time: "11:52", who: "You", type: "user", station: "move", text: "Picked Cursor, then resumed the agent's session to add one note." },
      { time: "12:30", who: "Builder agent", type: "agent", station: "done", text: "Finished the change; CI is green and the task links the merged PR." },
    ],
  },
  {
    key: "operations",
    label: "Finance & operations",
    headline: "Agents reconcile and chase; people approve what moves money.",
    pitch:
      "Agents reconcile, chase and file. When money moves or a vendor is chosen, they stop and ask, with the numbers and their recommendation in the request, and every answer stays on the record.",
    agents: ["Sweep the inbox for invoices and requests", "Reconcile and chase what is late", "Keep shared memory of vendors and policies"],
    decisions: ["Offer 5% to settle the disputed invoice?", "Which card does the renewal go on?", "Approve the Q4 close goal"],
    story: [
      { time: "07:02", who: "Mail clerk", type: "agent", station: "inbox", text: "Captured 6 tasks from the shared inbox, each linked to its email." },
      { time: "08:15", who: "Finance clerk", type: "agent", station: "move", text: "Claimed “Reconcile November invoices”." },
      {
        time: "09:12",
        who: "Finance clerk",
        type: "agent",
        station: "wait",
        text: "Asked: which card should the software renewal go on? It recommends the company card.",
        options: [{ label: "Company card", picked: true }, { label: "Team card" }],
      },
      { time: "09:20", who: "You", type: "user", station: "move", text: "Picked “Company card”; the morning digest had it at the top." },
      { time: "10:04", who: "Finance clerk", type: "agent", station: "done", text: "Completed the reconciliation and saved the vendor's billing terms to memory." },
    ],
  },
  {
    key: "founders",
    label: "Founders & chiefs of staff",
    headline: "Every agent you run, on one page you can read in a minute.",
    pitch:
      "Point your assistants at email, Slack and the calendar. They turn commitments into tasks under goals you approve, and the morning digest says what moved overnight and what needs you today.",
    agents: ["Turn commitments in email and Slack into tasks", "Propose goals to group the work", "Send the morning digest"],
    decisions: ["Approve the proposed goal “Hire a support lead”", "Which three candidates get interviews? Pick any", "Renew the office lease or move?"],
    story: [
      { time: "06:55", who: "Inbox sweeper", type: "agent", station: "inbox", text: "Captured 4 commitments from overnight email, with due dates." },
      { time: "07:00", who: "You", type: "user", station: "wait", text: "Read the morning digest email: 3 things waiting on you, 1 late, 6 done overnight." },
      { time: "07:40", who: "You", type: "user", station: "move", text: "Approved the goal “Hire a support lead” proposed by the planner." },
      {
        time: "08:05",
        who: "Recruiting agent",
        type: "agent",
        station: "wait",
        text: "Asked: which candidates get first interviews? Pick any.",
        options: [{ label: "Ana", picked: true }, { label: "Ben" }, { label: "Chidi", picked: true }],
      },
      { time: "08:40", who: "Recruiting agent", type: "agent", station: "done", text: "Booked both interviews and attached the briefing notes." },
    ],
  },
];

/** The MCP clients the docs show setup for; Phean works with any MCP client. */
export const CLIENTS = ["Claude Code", "Cursor", "VS Code"];

/**
 * Personal assistants, the agents most people will run first, named as the kind of agent Phean is
 * for. The page claims no setup guide or partnership for them: an assistant that can reach an MCP
 * server connects, and the copy says so.
 */
export const ASSISTANTS = ["Grok", "Dots", "Instinct", "Muse"];

/** What a morning of personal assistants asks you, as the Decisions page shows it. Illustrative. */
export const ASSISTANT_REQUESTS = [
  { agent: "Travel assistant", ask: "The 7:40 to Boston or the 9:15?", options: ["7:40", "9:15"], note: "Recommends 9:15: your 8:30 call stays put." },
  { agent: "Calendar assistant", ask: "Accept Dana's dinner on Thursday?", options: ["Accept", "Suggest Friday"], note: "You're free after 7." },
  { agent: "Shopping assistant", ask: "Which gifts for Mom? Pick any", options: ["Scarf", "Cookbook", "Spa day"], note: "All arrive before Sunday." },
] as const;
