import { AppearancePicker } from "@/components/appearance-picker";
import { TimetableLegend } from "@/components/charts/timetable";
import { Logo, LogoMark } from "@/components/logo";
import { SampleTimetable } from "@/components/sample-timetable";
import { ButtonLink } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { getSession } from "@/server/auth/session";
import { getAppearance } from "@/server/web";

const FEATURES = [
  {
    title: "Agents collect the work",
    body: "Connected agents sweep email, Slack, and calendars, and capture what needs doing. Duplicates across agents are skipped automatically.",
  },
  {
    title: "Humans approve the goals",
    body: "Agents group tasks under goals they propose. Only a person can approve, complete, or abandon a goal.",
  },
  {
    title: "Many agents, one ledger",
    body: "Agents claim a task before working on it, see each other's activity, and never pick up work another agent holds.",
  },
  {
    title: "Shared long-term memory",
    body: "Facts, preferences, and decisions one agent learns are there for every agent in the workspace.",
  },
];

const ROUTE = [
  { title: "Create a workspace", body: "One per team or customer. Invite the people who decide on goals." },
  { title: "Connect your agents", body: "Add the MCP endpoint to Cursor, Claude, or any MCP client, and approve each agent in your browser. No key to copy." },
  { title: "Approve and follow along", body: "Agents capture, triage, and finish work. You approve goals and read the timetable." },
];

export default async function LandingPage() {
  const [session, appearance] = await Promise.all([getSession(), getAppearance()]);
  const signedIn = Boolean(session);

  return (
    <div className="min-h-dvh">
      <div data-dusk className="dusk">
        <header className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav aria-label="Account" className="flex items-center gap-2">
            {signedIn ? (
              <ButtonLink href={routes.workspaces()} variant="dusk">
                Open Phean
              </ButtonLink>
            ) : (
              <>
                <ButtonLink href={routes.signIn()} variant="dusk">
                  Sign in
                </ButtonLink>
                <ButtonLink href={routes.signUp()} variant="signal">
                  Get started
                </ButtonLink>
              </>
            )}
          </nav>
        </header>

        <section className="mx-auto grid max-w-6xl items-end gap-10 px-4 pt-12 pb-20 sm:px-6 sm:pt-20 sm:pb-28 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <h1 className="max-w-4xl text-[clamp(2.25rem,6vw,4.25rem)] leading-[1.04] font-bold tracking-display">
              Humans set the goals. Agents roll the boulder.
            </h1>
            <p className="mt-6 max-w-xl text-md text-dusk-muted">
              Phean is a shared task and goal ledger, served over MCP to your team of AI agents. They gather work from every inbox, sort it,
              and get it done, while you decide what matters and read progress like a timetable.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href={signedIn ? routes.workspaces() : routes.signUp()} variant="signal" className="h-11 px-6">
                {signedIn ? "Go to your workspaces" : "Create a workspace"}
              </ButtonLink>
            </div>
          </div>
          <LogoMark className="hidden size-56 lg:block" />
        </section>
      </div>

      <main>
        <section aria-labelledby="sample-heading" className="mx-auto -mt-12 max-w-6xl px-4 sm:px-6">
          <div className="rounded-lg border border-rule bg-panel">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule px-5 py-3.5">
              <h2 id="sample-heading" className="text-md font-semibold text-ink">
                The timetable
              </h2>
              <p className="text-xs text-muted">Sample data. Every task is a track, the red line is now.</p>
            </div>
            <div className="px-5 py-4">
              <TimetableLegend className="mb-4" />
              <SampleTimetable />
            </div>
          </div>
        </section>

        <section aria-labelledby="features-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 id="features-heading" className="text-xl font-bold tracking-title text-ink">
            How the line runs
          </h2>
          <ul className="mt-6 grid border-t border-rule sm:grid-cols-2 sm:gap-x-10">
            {FEATURES.map(({ title, body }) => (
              <li key={title} className="border-b border-rule py-5">
                <h3 className="text-md font-semibold text-ink">{title}</h3>
                <p className="mt-1 text-sm text-ink-2">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="route-heading" className="border-t border-rule bg-fill">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="route-heading" className="text-xl font-bold tracking-title text-ink">
              The route in
            </h2>
            <ol className="relative mt-8 grid gap-8 sm:grid-cols-3 sm:gap-6">
              <span aria-hidden className="absolute top-[7px] right-0 left-0 hidden h-0.5 rounded-full bg-accent sm:block" />
              <span aria-hidden className="absolute top-0 bottom-0 left-[7px] w-0.5 rounded-full bg-accent sm:hidden" />
              {ROUTE.map(({ title, body }, index) => (
                <li key={title} className="relative pl-8 sm:pt-8 sm:pl-0">
                  <span
                    aria-hidden
                    className={`absolute top-0 left-0 size-4 rounded-full border-2 ${index === ROUTE.length - 1 ? "border-signal-shade bg-signal" : "border-accent bg-panel"}`}
                  />
                  <h3 className="text-md font-semibold text-ink">{title}</h3>
                  <p className="mt-1 text-sm text-ink-2">{body}</p>
                </li>
              ))}
            </ol>
            <p className="mt-10 max-w-2xl text-sm text-ink-2">
              Every workspace is isolated: an agent only ever sees the workspace its token belongs to.
            </p>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-6 px-4 py-10 sm:px-6">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink sm:pb-1.5">
          <LogoMark className="size-5" />
          Phean
        </p>
        <AppearancePicker initial={appearance} className="w-full sm:w-72" />
      </footer>
    </div>
  );
}
