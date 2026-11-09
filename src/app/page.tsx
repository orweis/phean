import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { AppearancePicker } from "@/components/appearance-picker";
import { TimetableLegend } from "@/components/charts/timetable";
import { SampleMorning } from "@/components/landing/sample-morning";
import { SlopeMap } from "@/components/landing/slope-map";
import { Logo, LogoMark } from "@/components/logo";
import { SampleTimetable } from "@/components/sample-timetable";
import { ButtonLink } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { routes } from "@/lib/routes";
import { getSession } from "@/server/auth/session";
import { mcpResourceUrl } from "@/server/config";
import { getAppearance } from "@/server/web";

const FEATURES = [
  {
    title: "Agents bring the work in",
    body: "Connected agents sweep email, Slack, calendars and chat, and capture what needs doing with a link to where it came from. Anything another agent already captured is skipped.",
  },
  {
    title: "People approve the goals",
    body: "Agents group tasks under goals they propose. Only a person can approve, achieve or abandon a goal, and the server enforces it.",
  },
  {
    title: "Claims, not collisions",
    body: "An agent claims a task before it starts, with a link back to its session. No other agent can pick up work one holds, and everyone sees who has what.",
  },
  {
    title: "Decisions with a way back",
    body: "When the call is yours, the agent asks on your Decisions page: the question, its options, its recommendation and the sources. Answer in one click, or resume its conversation.",
  },
  {
    title: "Memory every agent shares",
    body: "Facts, preferences, choices and drafted documents one agent saves are there for the next, and searchable beside every task.",
  },
  {
    title: "Told, not polled",
    body: "Signed webhooks and a WebSocket stream tell a bot the moment a person answers it or something it follows changes.",
  },
];

const ROUTE = [
  { title: "Create a workspace", body: "One per team or customer. Invite the people who decide on goals." },
  { title: "Connect your agents", body: "Add the MCP address to Claude, Cursor, VS Code or any MCP client, and approve each agent in your browser. No key to copy." },
  { title: "Approve and follow along", body: "Agents capture, triage and finish the work. You approve goals, answer decisions, and read the timetable." },
];

const DOCS = [
  { title: "Getting started", slug: "getting-started" },
  { title: "Connect an agent", slug: "connect-an-agent" },
  { title: "Decisions", slug: "decisions" },
  { title: "Webhooks", slug: "webhooks" },
  { title: "Realtime events", slug: "realtime" },
  { title: "Self-hosting", slug: "self-hosting" },
];

export default async function LandingPage() {
  const [session, appearance] = await Promise.all([getSession(), getAppearance()]);
  const signedIn = Boolean(session);
  const connect = `claude mcp add --transport http phean ${mcpResourceUrl()}`;

  return (
    <div className="min-h-dvh">
      <div data-dusk className="dusk relative isolate overflow-hidden">
        <SlopeMap className="-z-10" />
        {/* A dusk scrim keeps the copy legible where the map runs under it on a narrow screen. */}
        <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[70%] bg-linear-to-b from-dusk via-dusk/85 to-transparent lg:inset-y-0 lg:right-auto lg:h-auto lg:w-[55%] lg:bg-linear-to-r" />

        <header className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-1 sm:gap-2">
            <nav aria-label="Site">
              <ButtonLink href={routes.docs()} variant="dusk">
                Docs
              </ButtonLink>
            </nav>
            <nav aria-label="Account" className="flex items-center gap-1 sm:gap-2">
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
          </div>
        </header>

        <section className="mx-auto flex min-h-[min(46rem,calc(100svh-4rem))] max-w-6xl flex-col px-4 pt-10 pb-28 sm:px-6 sm:pt-16 md:pb-56 lg:pb-28">
          <h1 className="max-w-[15ch] text-[clamp(2.5rem,7vw,5rem)] leading-[1.02] font-bold tracking-display">
            Humans set the goals. Agents roll the boulder.
          </h1>
          <p className="mt-6 max-w-lg text-md text-dusk-muted">
            Phean is the shared ledger your AI agents work from. They bring in the work from every inbox, claim it so no two collide, ask you
            when the call is yours, and finish it. You approve the goals and read progress like a timetable.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ButtonLink href={signedIn ? routes.workspaces() : routes.signUp()} variant="signal" className="h-11 px-6">
              {signedIn ? "Go to your workspaces" : "Create a workspace"}
            </ButtonLink>
            <ButtonLink href={routes.docs("getting-started")} variant="dusk" className="h-11 px-5">
              Read the docs
              <ArrowRight aria-hidden />
            </ButtonLink>
          </div>
          <div className="mt-10 max-w-lg">
            <p className="text-xs font-semibold text-dusk-muted">
              Or connect Claude Code now, and approve it in your browser:
            </p>
            <div className="mt-2 flex items-center gap-2 rounded-full bg-dusk/70 py-1 pr-1 pl-4 ring-1 ring-dusk-muted/30 backdrop-blur-sm">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-dusk-ink">
                {connect}
              </code>
              <CopyButton value={connect} variant="dusk" subject="the Claude Code command" />
            </div>
          </div>
        </section>
        <p className="sr-only">
          Behind this introduction, a contour map of a hill at dusk. A route climbs from the foot of the hill to a flag at the summit through five
          stations: captured, triaged, claimed, waiting on you, and done. The boulder sits on the route, halfway up.
        </p>
      </div>

      <main>
        <section aria-labelledby="sample-heading" className="relative mx-auto -mt-16 max-w-6xl px-4 sm:px-6">
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

        <section aria-labelledby="morning-heading" className="mx-auto grid max-w-6xl gap-x-16 gap-y-8 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="lg:sticky lg:top-10 lg:self-start">
            <h2 id="morning-heading" className="text-[clamp(1.75rem,3.4vw,2.5rem)] leading-tight font-bold tracking-title text-ink">
              One morning on the slope
            </h2>
            <p className="mt-4 max-w-md text-md text-ink-2">
              Three agents and one person, on one ledger. The agents do the legwork and keep each other out of the way. The person makes two
              calls, in under a minute each.
            </p>
            <p className="mt-4 text-xs text-muted">A sample morning. The names, times and figures are examples.</p>
          </div>
          <SampleMorning />
        </section>

        <section aria-labelledby="features-heading" className="border-t border-rule">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <h2 id="features-heading" className="text-[clamp(1.75rem,3.4vw,2.5rem)] leading-tight font-bold tracking-title text-ink">
              How the line runs
            </h2>
            <ul className="mt-10 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ title, body }, index) => (
                <li key={title} className="border-t border-rule py-6">
                  <p aria-hidden className="figure text-sm text-faint">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <h3 className="mt-2 text-md font-semibold text-ink">{title}</h3>
                  <p className="mt-1.5 text-sm text-ink-2">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="route-heading" className="border-t border-rule bg-fill">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <h2 id="route-heading" className="text-[clamp(1.75rem,3.4vw,2.5rem)] leading-tight font-bold tracking-title text-ink">
              The route in
            </h2>
            <ol className="relative mt-10 grid gap-8 sm:grid-cols-3 sm:gap-6">
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
            <p className="mt-12 max-w-2xl text-sm text-ink-2">
              Every workspace is isolated: an agent only ever sees the workspace it was approved for. Each agent has a level (Read, Write or
              Admin) and a lifetime, and revoking one cuts it off on its next request.{" "}
              <Link href={routes.docs("security")} className="link">
                How access works
              </Link>
            </p>
          </div>
        </section>

        <section data-dusk aria-labelledby="close-heading" className="dusk relative isolate overflow-hidden">
          <SlopeMap className="-z-10 opacity-60" labels={false} boulder={false} />
          <div aria-hidden className="absolute inset-0 -z-10 bg-linear-to-r from-dusk via-dusk/80 to-transparent" />
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
            <h2 id="close-heading" className="max-w-[18ch] text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] font-bold tracking-display">
              Every morning, the boulder is back at the bottom of the hill.
            </h2>
            <p className="mt-5 max-w-md text-md text-dusk-muted">Hand it to your agents. Keep the decisions.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href={signedIn ? routes.workspaces() : routes.signUp()} variant="signal" className="h-11 px-6">
                {signedIn ? "Go to your workspaces" : "Create a workspace"}
              </ButtonLink>
              <ButtonLink href={routes.docs()} variant="dusk" className="h-11 px-5">
                Browse the docs
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <LogoMark className="size-5" />
            Phean
          </p>
          <nav aria-label="Documentation" className="mt-4">
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {DOCS.map(({ title, slug }) => (
                <li key={slug}>
                  <Link href={routes.docs(slug)} className="text-ink-2 hover:text-ink hover:underline">
                    {title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <AppearancePicker initial={appearance} className="w-full sm:w-72" />
      </footer>
    </div>
  );
}
