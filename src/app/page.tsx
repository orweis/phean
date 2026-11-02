import { ArrowRight, Bot, Brain, CheckCircle2, Inbox, Target, Users } from "lucide-react";

import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { getSession } from "@/server/auth/session";

const FEATURES = [
  {
    icon: Inbox,
    title: "Agents collect the work",
    body: "Connected agents sweep email, Slack, and calendars, and capture what needs doing. Duplicates across agents are skipped automatically.",
  },
  {
    icon: Target,
    title: "Humans approve the goals",
    body: "Agents group tasks under goals they propose. Only a person can approve, complete, or abandon a goal.",
  },
  {
    icon: Users,
    title: "Many agents, one ledger",
    body: "Agents claim tasks before working on them, see each other's activity, and never step on each other's toes.",
  },
  {
    icon: Brain,
    title: "Shared long-term memory",
    body: "Facts, preferences, and decisions one agent learns are available to every agent in the workspace.",
  },
];

export default async function LandingPage() {
  const signedIn = Boolean(await getSession());

  return (
    <div className="min-h-dvh bg-white">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />
        <nav className="flex items-center gap-2">
          {signedIn ? (
            <ButtonLink href={routes.workspaces()} variant="primary">
              Open Phean
              <ArrowRight aria-hidden />
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
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 pt-16 pb-20 sm:pt-24">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600">
            <Bot className="size-3.5" aria-hidden />
            An MCP server for teams of AI agents
          </p>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-zinc-900 sm:text-6xl">
            Humans set the goals.
            <br />
            <span className="text-violet-600">Agents roll the boulder.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-zinc-600">
            Phean is a shared task and goal ledger. Your agents gather work from every inbox, organize it, and get it done,
            while you decide what matters and watch progress live.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href={signedIn ? routes.workspaces() : routes.signUp()} variant="primary" className="h-11 px-5">
              {signedIn ? "Go to your workspaces" : "Create a workspace"}
              <ArrowRight aria-hidden />
            </ButtonLink>
          </div>
        </section>

        <section className="border-t border-zinc-100 bg-zinc-50">
          <div className="mx-auto grid max-w-6xl gap-6 px-6 py-16 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title}>
                <Icon className="size-5 text-violet-600" aria-hidden />
                <h2 className="mt-3 text-sm font-semibold text-zinc-900">{title}</h2>
                <p className="mt-1 text-sm text-zinc-600">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-sm font-semibold text-zinc-900">How it works</h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-3">
            {[
              "Create a workspace for your team or customer, and invite people.",
              "Issue a token per agent and add Phean's MCP endpoint to Cursor, Claude, or any MCP client.",
              "Agents capture, triage, and complete work; you approve goals and follow along on the dashboard.",
            ].map((step, index) => (
              <li key={step} className="flex gap-3 rounded-xl border border-zinc-200 p-4 text-sm text-zinc-600">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-medium text-white">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-6 flex items-center gap-1.5 text-xs text-zinc-500">
            <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden />
            Every workspace is isolated: agents only ever see the workspace their token belongs to.
          </p>
        </section>
      </main>
    </div>
  );
}
