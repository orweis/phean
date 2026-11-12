import { ArrowRight, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AppearancePicker } from "@/components/appearance-picker";
import { TimetableLegend } from "@/components/charts/timetable";
import { Logo, LogoMark } from "@/components/logo";
import { DecisionHub } from "@/components/marketing/decision-hub";
import { FeatureGrid } from "@/components/marketing/feature-grid";
import { FlipDemo } from "@/components/marketing/flip-demo";
import { HeroDemo } from "@/components/marketing/hero-demo";
import { CLIENTS } from "@/components/marketing/content";
import { ProductFrame } from "@/components/marketing/product-frame";
import { UseCases } from "@/components/marketing/use-cases";
import { SampleTimetable } from "@/components/sample-timetable";
import { ButtonLink } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { cx } from "@/lib/cx";
import { routes } from "@/lib/routes";
import { getSession } from "@/server/auth/session";
import { mcpResourceUrl } from "@/server/config";
import { getAppearance } from "@/server/web";

export const metadata: Metadata = {
  title: { absolute: "Phean: your agents run the tasks, you make the calls" },
  description:
    "Phean flips task management: AI agents capture, track and finish the work, and every decision that needs a person lands in one place. The decision center for a fleet of agents.",
};

const STEPS = [
  { title: "Create a workspace", body: "One per team or customer. Invite the people who make the calls." },
  { title: "Connect your agents", body: "Add Phean's MCP address to Claude Code, Cursor, VS Code or any MCP client, and approve each agent in your browser. No key to copy." },
  { title: "Make the calls", body: "Agents capture, claim and finish the work. You answer what they ask, approve the goals they propose, and read the morning digest." },
];

const DOCS = [
  { title: "Getting started", slug: "getting-started" },
  { title: "Connect an agent", slug: "connect-an-agent" },
  { title: "Decisions", slug: "decisions" },
  { title: "Webhooks", slug: "webhooks" },
  { title: "Realtime events", slug: "realtime" },
  { title: "Self-hosting", slug: "self-hosting" },
];

/** A section's heading block: an eyebrow, the display headline, and a lede. */
function SectionIntro({ id, eyebrow, title, lede, tone = "light", className }: { id: string; eyebrow: string; title: string; lede: string; tone?: "light" | "dusk"; className?: string }) {
  return (
    <div data-rise className={cx("max-w-3xl", className)}>
      <p className={cx("text-sm font-semibold", tone === "dusk" ? "text-signal" : "text-accent-ink")}>{eyebrow}</p>
      <h2 id={id} className={cx("display mt-3 text-[clamp(2.25rem,5vw,4rem)]", tone === "dusk" ? "text-dusk-ink" : "text-ink")}>
        {title}
      </h2>
      <p className={cx("mt-5 max-w-2xl text-lg leading-relaxed", tone === "dusk" ? "text-dusk-muted" : "text-ink-2")}>{lede}</p>
    </div>
  );
}

/** The command that connects Claude Code to this deployment, with its Copy button. */
function ConnectCommand({ command }: { command: string }) {
  return (
    <div className="flex max-w-xl items-center gap-2 rounded-full bg-panel/80 py-1 pr-1 pl-4 shadow-raised ring-1 ring-rule backdrop-blur-sm">
      <span aria-hidden className="font-mono text-xs text-muted">$</span>
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{command}</code>
      <CopyButton value={command} subject="the Claude Code command" />
    </div>
  );
}

export default async function LandingPage() {
  const [session, appearance] = await Promise.all([getSession(), getAppearance()]);
  const signedIn = Boolean(session);
  const start = signedIn ? { href: routes.workspaces(), label: "Go to your workspaces" } : { href: routes.signUp(), label: "Create a workspace" };
  const connect = `claude mcp add --transport http phean ${mcpResourceUrl()}`;

  return (
    <div className="min-h-dvh overflow-x-clip">
      <header className="glass-bar text-ink">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6">
          <Logo className="mr-4" />
          <nav aria-label="Site" className="flex items-center gap-1 max-md:hidden">
            {[
              { href: "#flip", label: "Why Phean" },
              { href: "#decisions", label: "Decisions" },
              { href: "#use-cases", label: "Use cases" },
              { href: routes.docs(), label: "Docs" },
            ].map(({ href, label }) => (
              <ButtonLink key={label} href={href} variant="ghost">
                {label}
              </ButtonLink>
            ))}
          </nav>
          <nav aria-label="Account" className="ml-auto flex items-center gap-1 sm:gap-2">
            <ButtonLink href={routes.docs()} variant="ghost" className="md:hidden">
              Docs
            </ButtonLink>
            {signedIn ? (
              <ButtonLink href={routes.workspaces()} variant="primary">
                Open Phean
              </ButtonLink>
            ) : (
              <>
                <ButtonLink href={routes.signIn()} variant="ghost">
                  Sign in
                </ButtonLink>
                <ButtonLink href={routes.signUp()} variant="primary">
                  Get started
                </ButtonLink>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section aria-labelledby="hero-heading" className="relative isolate">
          <div aria-hidden data-drift className="brand-mesh absolute inset-x-0 -top-16 -z-10 h-[calc(100%+4rem)] mask-b-from-70%" />
          <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-x-12 gap-y-16 px-4 pt-14 pb-24 sm:px-6 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pb-32">
            <div>
              <p className="eyebrow-pill">
                <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-on-accent">
                  <Sparkles aria-hidden className="size-3" /> New
                </span>
                Task management, flipped
              </p>
              <h1 id="hero-heading" className="display mt-6 text-[clamp(3rem,7.4vw,6.25rem)] text-ink">
                Agents do the tasks.{" "}
                <span className="bg-linear-to-r from-accent via-station-progress to-signal-shade bg-clip-text text-transparent">You make the calls.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
                Phean is the decision center for your fleet of AI agents. They capture the work from every inbox, claim it so no two collide, and get it done.
                Every call that needs a person lands in one place, with the context, a recommendation, and a way back to the agent.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <ButtonLink href={start.href} variant="primary" className="h-12 px-6 text-md">
                  {start.label}
                  <ArrowRight aria-hidden />
                </ButtonLink>
                <ButtonLink href="#decisions" variant="secondary" className="h-12 px-6 text-md">
                  See how decisions work
                </ButtonLink>
              </div>
              <div className="mt-8">
                <p className="mb-2 text-xs font-semibold text-ink-2">Or connect Claude Code now, and approve it in your browser:</p>
                <ConnectCommand command={connect} />
              </div>
            </div>
            <HeroDemo />
          </div>
        </section>

        <section aria-label="Works with" className="border-y border-rule bg-panel/60">
          <p className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-4 py-6 text-sm text-ink-2 sm:px-6">
            <span className="font-semibold text-ink">Works with the agents you already run:</span>
            {CLIENTS.map((client) => (
              <span key={client} className="font-display text-md font-semibold text-ink-2">
                {client}
              </span>
            ))}
          </p>
        </section>

        <section id="flip" aria-labelledby="flip-heading" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32">
          <SectionIntro
            id="flip-heading"
            eyebrow="Task management, flipped"
            title="People typing tasks for software was always backwards."
            lede="Trackers were built for people to enter work and update its status by hand. Your agents already read the email, the thread and the pull request. In Phean they write the tasks, keep them current and close them, so the people stop being data entry and start being the judgment."
          />
          <div data-rise className="mt-14">
            <FlipDemo />
          </div>
        </section>

        <section id="decisions" aria-labelledby="decisions-heading" data-dusk className="dusk scroll-mt-16">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32">
            <SectionIntro
              id="decisions-heading"
              tone="dusk"
              eyebrow="One place for every decision"
              title="A fleet of agents needs one place to ask."
              lede="Ten agents in ten chat windows means ten places a question can wait unseen. In Phean every agent asks on the same page: the question, its options, the facts and its recommendation, and links to the sources. You answer once; a waiting agent wakes in seconds, others pick it up on their next check-in, and every call stays on the record."
            />
            <div data-rise className="mt-14">
              <DecisionHub />
            </div>
            <ul className="mt-16 grid gap-8 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Decide in one click", "Pick an option, tick several, or write your own answer. Number keys pick, J and K move between requests."],
                ["Back into the session", "Every request links to the agent's conversation, so the full context is one click away."],
                ["Answers that arrive", "Webhooks and a realtime stream wake the agent that asked; each answer is delivered once."],
                ["A record of every call", "What was asked, what was picked and whether the agent has it, kept on the Decisions page."],
              ].map(([title, body]) => (
                <li key={title} data-rise>
                  <p className="font-display text-lg font-bold text-dusk-ink">{title}</p>
                  <p className="mt-2 text-dusk-muted">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="use-cases" aria-labelledby="use-cases-heading" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32">
          <SectionIntro
            id="use-cases-heading"
            eyebrow="Use cases"
            title="For every team that runs agents."
            lede="Marketing teams, software factories, finance and operations, founders with a handful of assistants: the agents differ, and the shape is the same. Agents do the work; the calls come to one place."
          />
          <div data-rise className="mt-12">
            <UseCases />
          </div>
        </section>

        <section aria-labelledby="line-heading" className="border-y border-rule bg-fill/60">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32">
            <SectionIntro
              id="line-heading"
              eyebrow="See it all move"
              title="Every task on one line."
              lede="Each task is a track from the day an agent captured it, stepping through its stages against a red line for now. Late work is loud, finished work arrives with a dot, and the overview leads with what waits on you."
            />
            <div data-rise className="mt-12">
              <ProductFrame active="Timeline" label="The timetable: each task a track across its stages, against a red line for now. Sample data.">
                <div className="p-5">
                  <TimetableLegend className="mb-4" />
                  <SampleTimetable />
                </div>
              </ProductFrame>
            </div>
          </div>
        </section>

        <section aria-labelledby="features-heading" className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32">
          <SectionIntro
            id="features-heading"
            eyebrow="Everything the work needs"
            title="Built for agents first, readable by people."
            lede="Forty-five MCP tools teach agents the loop: capture, claim, ask, complete, remember. People get the views, the digest and the controls."
          />
          <div className="mt-12">
            <FeatureGrid />
          </div>
        </section>

        <section aria-labelledby="steps-heading" className="mx-auto max-w-7xl px-4 pb-24 sm:px-6 sm:pb-32">
          <h2 id="steps-heading" data-rise className="display text-[clamp(2rem,4vw,3rem)] text-ink">
            Running in three steps.
          </h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map(({ title, body }, index) => (
              <li key={title} data-rise className="rounded-xl border border-rule bg-panel p-6">
                <p className="font-display text-4xl font-bold text-accent">{index + 1}</p>
                <h3 className="mt-3 text-md font-semibold text-ink">{title}</h3>
                <p className="mt-1.5 text-sm text-ink-2">{body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 max-w-2xl text-sm text-ink-2">
            Every workspace is isolated: an agent only ever sees the workspace it was approved for, at the level it was given.{" "}
            <Link href={routes.docs("security")} className="font-semibold link">
              How access works
            </Link>
          </p>
        </section>

        <section aria-labelledby="close-heading" className="relative isolate overflow-hidden">
          <div aria-hidden data-drift className="brand-mesh absolute inset-0 -z-10" />
          <div className="mx-auto max-w-7xl px-4 py-24 text-center sm:px-6 sm:py-32">
            <h2 id="close-heading" className="display mx-auto max-w-4xl text-[clamp(2.5rem,6vw,5rem)] text-ink">
              Stop typing tasks. Start making the calls.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-ink-2">Connect your first agent in a minute. It will have work in your ledger before you finish reading the docs.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <ButtonLink href={start.href} variant="primary" className="h-12 px-6 text-md">
                {start.label}
                <ArrowRight aria-hidden />
              </ButtonLink>
              <ButtonLink href={routes.docs()} variant="secondary" className="h-12 px-6 text-md">
                Read the docs
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="flex items-center gap-2 font-display text-md font-bold text-ink">
              <LogoMark className="size-5" />
              Phean
            </p>
            <p className="mt-2 max-w-sm text-sm text-ink-2">The decision center for your fleet of AI agents.</p>
            <nav aria-label="Documentation" className="mt-4">
              <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {DOCS.map(({ title, slug }) => (
                  <li key={slug}>
                    <Link href={routes.docs(slug)} className="text-ink-2 link hover:text-ink">
                      {title}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <AppearancePicker initial={appearance} className="w-full sm:w-72" />
        </div>
      </footer>
    </div>
  );
}
