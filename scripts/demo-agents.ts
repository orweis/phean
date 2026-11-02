/**
 * Plays two agents sharing one workspace over the real MCP endpoint: one sweeps the inbox,
 * the other plans from the calendar. Useful as a smoke test of a deployment and as a demo.
 *
 *   pnpm demo:agents <base-url> <token-a> <token-b>
 *   pnpm demo:agents http://localhost:3000 phn_... phn_...
 */
import { connectAgent, type ToolArgs as Data } from "./mcp-agent";

const [baseUrl, tokenA, tokenB] = process.argv.slice(2);
if (!baseUrl || !tokenA || !tokenB) {
  console.error("Usage: pnpm demo:agents <base-url> <token-a> <token-b>");
  process.exit(1);
}

interface Task {
  id: string;
  title: string;
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const sweeper = await connectAgent(baseUrl, tokenA, "inbox-sweeper");
const planner = await connectAgent(baseUrl, tokenB, "calendar-planner");
const [a, b] = await Promise.all([sweeper.call<Data>("whoami"), planner.call<Data>("whoami")]);
console.log(`Connected as ${JSON.stringify(a.agent)} and ${JSON.stringify(b.agent)} in ${JSON.stringify(a.workspace)}`);

// The sweeper proposes goals for what it sees piling up, then captures the work.
const books = await sweeper.call<{ goal: { id: string } }>("create_goal", {
  title: "Close Q3 books",
  description: "All Q3 invoices reconciled, expenses filed, and the board pack sent by the 10th.",
});
const portal = await sweeper.call<{ goal: { id: string } }>("create_goal", {
  title: "Launch customer portal v2",
  description: "Self-serve billing and SSO for enterprise customers.",
});
const captured = await sweeper.call<{ created: Task[] }>("capture_tasks", {
  tasks: [
    { title: "Reconcile August Stripe payouts", source: "email", sourceRef: "gmail:thread/18c1", priority: "high", dueDate: day(-2), goalId: books.goal.id },
    { title: "Chase Globex for overdue invoice #4471", source: "email", sourceRef: "gmail:thread/18c7", priority: "urgent", dueDate: day(1), goalId: books.goal.id },
    { title: "File September travel expenses", source: "slack", sourceRef: "slack:C02/p1699", dueDate: day(5), goalId: books.goal.id },
    { title: "Review SSO vendor shortlist", source: "slack", sourceRef: "slack:C07/p1702", priority: "high", goalId: portal.goal.id },
    { title: "Draft portal v2 announcement", source: "email", sourceRef: "gmail:thread/18d2", dueDate: day(9) },
    { title: "Renew the office lease", source: "email", sourceRef: "gmail:thread/18d9", priority: "low", dueDate: day(20) },
  ],
});
await sweeper.call("remember", {
  kind: "preference",
  content: "Finance wants invoices chased by email, never by Slack, and always cc ar@acme.example.",
  tags: ["billing"],
  goalId: books.goal.id,
});
console.log(`Sweeper proposed 2 goals and captured ${captured.created.length} tasks`);

// The planner works from the calendar; one item was already captured from email and is skipped.
const fromCalendar = await planner.call<{ created: Task[]; duplicates: unknown[] }>("capture_tasks", {
  tasks: [
    { title: "Chase Globex for overdue invoice #4471", source: "email", sourceRef: "gmail:thread/18c7" },
    { title: "Prepare Q3 board pack", source: "calendar", sourceRef: "gcal:evt/q3-board", priority: "high", dueDate: day(3), status: "todo" },
    { title: "Portal v2 design review", source: "calendar", sourceRef: "gcal:evt/portal-review", dueDate: day(2), status: "todo" },
  ],
});
console.log(`Planner captured ${fromCalendar.created.length} tasks, skipped ${fromCalendar.duplicates.length} duplicate`);

const milestone = await planner.call<{ goal: { id: string } }>("create_goal", {
  title: "Board pack sent",
  parentGoalId: books.goal.id,
});
const [boardPack, designReview] = fromCalendar.created;
await planner.call("assign_tasks_to_goal", { taskIds: [boardPack!.id], goalId: milestone.goal.id });
await planner.call("assign_tasks_to_goal", { taskIds: [designReview!.id], goalId: portal.goal.id });

// Both agents pull from the same queue; claims keep them from doing the same work twice.
const { tasks: next } = await planner.call<{ tasks: Task[] }>("suggest_next_actions", { limit: 3 });
const first = next[0]!;
await planner.call("claim_task", { taskId: first.id });
const conflict = await sweeper.client.callTool({ name: "claim_task", arguments: { taskId: first.id } });
console.log(`Planner claimed "${first.title}"; sweeper's claim was ${conflict.isError ? "refused" : "accepted (unexpected)"}`);
await planner.call("complete_task", { taskId: first.id, note: "Sent a reminder with the invoice attached, cc ar@acme.example." });

const stripe = captured.created.find((task) => task.title.startsWith("Reconcile"))!;
await sweeper.call("claim_task", { taskId: stripe.id });
await planner.call("remember", {
  kind: "decision",
  content: "Board pack uses the new KPI template agreed in the Sept 12 leadership sync.",
  goalId: milestone.goal.id,
});

const summary = await sweeper.call<Data>("get_status_summary");
console.log(
  `Status: ${summary.openTasks} open, ${summary.overdue} overdue, ${summary.pendingApprovals} goals awaiting approval → ${summary.dashboardUrl}`,
);
await Promise.all([sweeper.client.close(), planner.client.close()]);
