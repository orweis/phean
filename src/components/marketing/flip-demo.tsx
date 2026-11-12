import { ArrowRight, GitPullRequest, Mail, MessageSquare } from "lucide-react";
import { StationDot } from "@/components/task-marks";
import { ActorAvatar } from "@/components/ui/avatar";

const CAPTURED = [
  { icon: Mail, source: "an email", who: "Mail clerk", text: "Follow up with Northwind about the renewal", status: "inbox" },
  { icon: MessageSquare, source: "a Slack thread", who: "Slack scout", text: "Draft the launch post from #marketing", status: "inbox" },
  { icon: GitPullRequest, source: "an issue", who: "Triage agent", text: "Fix the flaky export test", status: "in_progress" },
  { icon: Mail, source: "an email", who: "Mail clerk", text: "Send W-9s to two new vendors", status: "done" },
] as const;

/**
 * Task management, flipped: on the left the old ritual (a person typing a task into a form for other
 * people), on the right the same work arriving from email, Slack and issues by itself, captured,
 * claimed and closed by agents. Its lines rise in once as they scroll into view; both sides are sample pictures.
 */
export function FlipDemo() {
  return (
    <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <figure className="rounded-lg border border-dashed border-edge bg-fill/60 p-5">
        <figcaption className="text-xs font-semibold text-muted">Before: you, typing</figcaption>
        <div aria-hidden className="mt-4 space-y-3 opacity-80 grayscale">
          {[
            ["Title", "Follow up with Northwind about the re|"],
            ["Assignee", "Select someone…"],
            ["Status", "To do"],
            ["Due date", "mm/dd/yyyy"],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-2xs font-semibold text-ink-2">{label}</p>
              <p className="mt-1 rounded-md border border-edge bg-panel px-3 py-2 text-xs text-muted">{value}</p>
            </div>
          ))}
          <p className="inline-flex h-8 items-center rounded-full bg-rule px-4 text-xs font-semibold text-ink-2">Create task</p>
        </div>
        <p className="mt-4 text-sm text-ink-2">Every task, every status change and every reminder, entered and updated by hand, for software to read back to you.</p>
      </figure>

      <span aria-hidden className="flex items-center justify-center text-faint">
        <ArrowRight className="size-6 max-md:rotate-90" />
      </span>

      <figure className="product-frame p-5">
        <figcaption className="text-xs font-semibold text-accent-ink">Now: your agents, on their own</figcaption>
        <ul className="mt-4 space-y-3">
          {CAPTURED.map(({ icon: Icon, source, who, text, status }) => (
            <li key={text} data-rise className="flex items-start gap-3 border-b border-rule pb-3 last:border-b-0 last:pb-0">
              <ActorAvatar type="agent" />
              <div className="min-w-0 text-xs">
                <p className="font-semibold text-ink">{text}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
                  <span className="inline-flex items-center gap-1">
                    <StationDot status={status} />
                    {status === "inbox" ? "Captured" : status === "in_progress" ? "Claimed" : "Done"} by {who}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Icon aria-hidden className="size-3" /> from {source}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-ink-2">Agents read the email, the thread and the issue before you do. They write the task, keep it current, and close it with a note.</p>
      </figure>
    </div>
  );
}
