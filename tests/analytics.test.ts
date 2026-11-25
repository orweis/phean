import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanParams, clientHint, derivedEvents, registrableDomain, COMMON_PARAMS, countBucket, EVENTS, redactLocation, redactReferrer, USER_PROPERTIES, workspaceCountBucket } from "@/lib/analytics";
import { routes } from "@/lib/routes";
import { analyticsConfig, analyticsHash, serverEventBody } from "@/server/analytics";

const DICTIONARY = readFileSync("docs/ANALYTICS.md", "utf8");

/** Keys that would carry something personal or private, whatever the event. */
const PII = /(^|_)(email|e_mail|name|title|note|notes|question|answer_text|answer|url|uri|href|query|term|search_term|slug|text|body|phone|address|ip|token|secret)$/;
/** Public values: a doc or post slug, an outbound link on the public site. */
const ALLOWED_URLISH = new Set(["link_url", "post_slug", "doc_slug"]);

describe("the analytics catalog", () => {
  it("has no key that looks personal", () => {
    const params = [...Object.values(EVENTS).flatMap((event) => Object.entries(event.params)), ...Object.entries(COMMON_PARAMS), ...Object.entries(USER_PROPERTIES)];
    for (const [key, type] of params) {
      // A yes/no flag (`first_answer`, `custom_answer`) says nothing about what was written.
      if (ALLOWED_URLISH.has(key) || type === "boolean") continue;
      expect(key, key).not.toMatch(PII);
    }
  });

  it("documents every event, with its key-event and server marks, in docs/ANALYTICS.md", () => {
    for (const [name, spec] of Object.entries(EVENTS)) {
      const row = DICTIONARY.split("\n").find((line) => line.startsWith(`| \`${name}\` |`));
      expect(row, name).toBeTruthy();
      if ("key" in spec && spec.key) expect(row, name).toContain("**key**");
      if ("server" in spec) expect(row, name).toMatch(spec.server === "only" ? /\| only \|$/ : /\| also/);
      for (const param of Object.keys(spec.params)) expect(row, `${name}.${param}`).toContain(`\`${param}\``);
    }
  });

  it("marks the plan's key events", () => {
    const keys = Object.entries(EVENTS).filter(([, spec]) => "key" in spec && spec.key).map(([name]) => name);
    expect(keys.sort()).toEqual(["agent_connect_approve", "first_decision_answer", "pipeline_create", "sign_up", "workspace_create"]);
  });

  it("keeps only the params an event lists, in their types", () => {
    expect(cleanParams(EVENTS.task_move.params, { from_kind: "todo", to_kind: "done", via: "drag", title: "Secret plan" })).toEqual({ from_kind: "todo", to_kind: "done", via: "drag" });
    expect(cleanParams(EVENTS.task_move.params, { via: "telepathy" })).toEqual({});
    expect(cleanParams(EVENTS.workflow_save.params, { stages_count: "5" })).toEqual({});
    expect(cleanParams(EVENTS.cta_click.params, { cta_id: "x".repeat(101) })).toEqual({});
  });

  it("keeps only the registrable part of an app link's host", () => {
    expect(registrableDomain("acme-corp.slack.com")).toBe("slack.com");
    expect(registrableDomain("jane.laptop.tailnet.ts.net")).toBe("ts.net");
    expect(registrableDomain("acme.sharepoint.co.uk")).toBe("sharepoint.co.uk");
    expect(registrableDomain("github.com")).toBe("github.com");
    expect(registrableDomain("10.0.0.12")).toBe("ip");
  });

  it("buckets counts, and names clients", () => {
    expect([0, 1, 2, 3, 4, 9, 10, 24, 25, 1000].map(countBucket)).toEqual(["0", "1", "2-3", "2-3", "4-9", "4-9", "10-24", "10-24", "25+", "25+"]);
    expect([1, 2, 3, 4, 40].map(workspaceCountBucket)).toEqual(["1", "2-3", "2-3", "4+", "4+"]);
    expect(clientHint("Claude Code")).toBe("claude_code");
    expect(clientHint("Cursor")).toBe("cursor");
    expect(clientHint("Visual Studio Code")).toBe("vscode");
    expect(clientHint("ChatGPT")).toBe("chatgpt");
    expect(clientHint("my-bot by alice@example.com")).toBe("other");
    expect(clientHint(null)).toBe("other");
  });
});

const SLUG = "acme-secret";
const ID = "t_9f8e7d";

/** Every route in `routes`, built with values that must never reach GA, and the pattern GA should see. */
const ROUTE_CASES: [string, string][] = [
  [routes.home(), "/"],
  [routes.docs(), "/docs"],
  [routes.docs("mcp-reference"), "/docs/mcp-reference"],
  [routes.blog(), "/blog"],
  [routes.blog("hello-world"), "/blog/hello-world"],
  [routes.blog(undefined, 2), "/blog"],
  [routes.blogTag("agents"), "/blog/tag/agents"],
  [routes.blogAuthor("or-weis"), "/blog/author/or-weis"],
  [routes.blogFeed(), "/blog/rss.xml"],
  [routes.privacy(), "/privacy"],
  [routes.signIn(`/w/${SLUG}`), "/sign-in"],
  [routes.signUp(`/invite/${ID}`), "/sign-up"],
  [routes.twoFactor(`/w/${SLUG}`), "/sign-in/two-factor"],
  [routes.account(), "/account"],
  [routes.workspaces(), "/workspaces"],
  [routes.app(), "/w"],
  [routes.workspace(SLUG), "/w/[slug]"],
  [routes.questions(SLUG), "/w/[slug]"],
  [routes.decisions(SLUG), "/w/[slug]/decisions"],
  [routes.decision(SLUG, ID), "/w/[slug]/decisions"],
  [routes.request(SLUG, "q_123"), "/w/[slug]/decisions"],
  [routes.approvals(SLUG), "/w/[slug]/decisions"],
  [routes.quickDecisions(SLUG, { request: "q_123", view: "file", file: "d_1", from: "button" }), "/w/[slug]/decisions/quick"],
  [routes.board(SLUG, { goal: "g_1", q: "secret search" } as never), "/w/[slug]/board"],
  [routes.tasksByStatus(SLUG, "todo", "g_1"), "/w/[slug]/board"],
  [routes.timeline(SLUG, { goal: "g_1" }), "/w/[slug]/timeline"],
  [routes.goals(SLUG, "all"), "/w/[slug]/goals"],
  [routes.goal(SLUG, "g_1"), "/w/[slug]/goals/[id]"],
  [routes.task(SLUG, ID), "/w/[slug]/tasks/[id]"],
  [routes.memory(SLUG, { q: "my secret" }), "/w/[slug]/memory"],
  [routes.memoryItem(SLUG, "m_1"), "/w/[slug]/memory"],
  [routes.pipelines(SLUG), "/w/[slug]/pipelines"],
  [routes.pipeline(SLUG, "p_1", { tab: "runs" }), "/w/[slug]/pipelines/[id]"],
  [routes.pipelineRun(SLUG, "r_1", { view: "timeline" }), "/w/[slug]/pipelines/runs/[id]"],
  [routes.pipelineTrigger("p_1"), "/[other]"],
  [routes.link(SLUG, ID), "/w/[slug]/link/[id]"],
  [routes.documents(SLUG, "contract"), "/w/[slug]/documents"],
  [routes.document(SLUG, "d_1", "edit"), "/w/[slug]/documents/[id]"],
  [routes.documentFile(SLUG, "d_1", true), "/w/[slug]/documents/[id]/file"],
  [routes.suggest(SLUG, "secret"), "/w/[slug]/suggest"],
  [routes.search(SLUG, "salary of bob"), "/w/[slug]/search"],
  [routes.digest(SLUG), "/w/[slug]/digest"],
  [routes.agents(SLUG), "/w/[slug]/agents"],
  [routes.members(SLUG), "/w/[slug]/members"],
  [routes.settings(SLUG), "/w/[slug]/settings"],
  [routes.invite("inv_abc123"), "/invite/[id]"],
  [routes.mcp(), "/[other]"],
  [routes.mcp(SLUG), "/[other]"],
  [routes.oauthApprove("client_id=abc&state=xyz&code_challenge=123"), "/oauth/approve"],
  [routes.nativeAuthorize("req_1"), "/native/authorize"],
  [routes.nativeConfirm(), "/native/authorize/confirm"],
  [routes.pushAnswer(SLUG), "/w/[slug]/push/answer"],
  [routes.pushUndo(SLUG), "/w/[slug]/push/undo"],
  [routes.nativeInbox(), "/[other]"],
  [routes.events(), "/[other]"],
  [routes.offline(), "/offline"],
  [routes.serviceWorker(), "/[other]"],
  [routes.appIcon(192), "/[other]"],
];

describe("redaction", () => {
  it("covers every route in routes", () => {
    // One case per route at least: a new route needs a case here.
    expect(ROUTE_CASES.length).toBeGreaterThanOrEqual(Object.keys(routes).length);
  });

  it.each(ROUTE_CASES)("%s becomes %s", (url, pattern) => {
    const [path, query = ""] = url.split("?");
    const redacted = redactLocation(path!.split("#")[0]!, query);
    expect(redacted.path).toBe(pattern);
    const sent = `${redacted.path}${redacted.search}`;
    for (const secret of [SLUG, ID, "secret", "salary", "inv_abc", "client_id", "state=", "req_1", "d_1", "p_1", "r_1", "g_1", "q_123", "m_1"]) {
      expect(sent, url).not.toContain(secret);
    }
  });

  it("keeps campaign tags on public pages, and never a search term", () => {
    expect(redactLocation("/", "utm_source=x&utm_medium=y&ref=hn&email=a@b.c").search).toBe("?utm_source=x&utm_medium=y&ref=hn");
    expect(redactLocation("/docs", "q=jane@acme.com").search).toBe("");
    expect(redactLocation("/", "q=webhooks").search).toBe("");
    expect(redactLocation("/w/acme/search", "q=x&utm_source=y").search).toBe("");
    expect(redactLocation("/sign-up", "utm_source=y").search).toBe("");
  });

  it("names the surface of each part of the site", () => {
    expect(["/", "/privacy", "/docs/x", "/blog", "/sign-in", "/invite/x", "/oauth/approve", "/w/a", "/account", "/workspaces"].map((path) => redactLocation(path).surface)).toEqual([
      "marketing",
      "marketing",
      "docs",
      "blog",
      "auth",
      "auth",
      "oauth",
      "app",
      "app",
      "app",
    ]);
  });

  it("keeps a public slug only when it looks like one", () => {
    expect(redactLocation("/docs/Some%20Thing@x").path).toBe("/docs/[other]");
    expect(redactLocation("/random/thing").path).toBe("/[other]");
  });

  it("reduces another site's referrer to its origin, and redacts this site's", () => {
    expect(redactReferrer("https://news.ycombinator.com/item?id=1", "https://phean.ai")).toBe("https://news.ycombinator.com/");
    expect(redactReferrer("https://phean.ai/w/acme/tasks/t_1?x=1", "https://phean.ai")).toBe("https://phean.ai/w/[slug]/tasks/[id]");
    expect(redactReferrer("", "https://phean.ai")).toBeUndefined();
  });
});

describe("the server side", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("loads GA only on Vercel production and previews with an id, or for a UI test that asks", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "G-ABC123");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("PHEAN_ANALYTICS_TEST_ID", "");
    expect(analyticsConfig()).toBeNull();
    vi.stubEnv("VERCEL_ENV", "production");
    expect(analyticsConfig()).toEqual({ measurementId: "G-ABC123", debug: false });
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(analyticsConfig()).toEqual({ measurementId: "G-ABC123", debug: true });
    vi.stubEnv("VERCEL_ENV", "development");
    expect(analyticsConfig("1")).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "not-an-id");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(analyticsConfig()).toBeNull();
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("PHEAN_ANALYTICS_TEST_ID", "G-TEST123");
    expect(analyticsConfig()).toBeNull();
    expect(analyticsConfig("1")).toEqual({ measurementId: "G-TEST123", debug: true });
  });

  it("hashes ids with the salt, and sends none without it", () => {
    vi.stubEnv("ANALYTICS_ID_SALT", "");
    expect(analyticsHash("user", "u_1")).toBeUndefined();
    vi.stubEnv("ANALYTICS_ID_SALT", "pepper");
    const hash = analyticsHash("user", "u_1")!;
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).not.toBe(analyticsHash("workspace", "u_1"));
    expect(hash).not.toContain("u_1");
  });

  it("builds Measurement Protocol bodies under the hashed workspace, naming no person, with catalog params only", () => {
    vi.stubEnv("ANALYTICS_ID_SALT", "pepper");
    const body = serverEventBody({ name: "decision_ask", params: { kind: "decision", with_options: true, question: "Fire Bob?" } as never, userId: "u_1", tenantId: "t_1" })!;
    // The server cannot know whether the person accepted analytics, so its events name none.
    expect(body).not.toHaveProperty("user_id");
    expect(body.client_id).toBe(`srv.${analyticsHash("workspace", "t_1")}`);
    expect(JSON.stringify(body)).not.toContain(analyticsHash("user", "u_1")!);
    const [event] = body.events as { name: string; params: Record<string, unknown> }[];
    expect(event!.name).toBe("decision_ask");
    expect(event!.params).toMatchObject({ kind: "decision", with_options: true, workspace_hash: analyticsHash("workspace", "t_1"), source_side: "server" });
    expect(JSON.stringify(body)).not.toContain("Fire Bob");
    expect(JSON.stringify(body)).not.toContain("u_1");
    expect(JSON.stringify(body)).not.toContain("t_1");
    // With no workspace (a sign-up) the client id is random, and still names no one.
    const lone = serverEventBody({ name: "sign_up", params: { method: "password" }, userId: "u_1" })!;
    expect(lone).not.toHaveProperty("user_id");
    expect(lone.client_id).toMatch(/^srv\.[0-9a-f-]{36}$/);
    expect(lone.client_id).not.toBe(serverEventBody({ name: "sign_up", params: { method: "password" }, userId: "u_1" })!.client_id);
    expect((lone.events as { params: Record<string, unknown> }[])[0]!.params).not.toHaveProperty("workspace_hash");
    expect(JSON.stringify(lone)).not.toContain("u_1");
    expect(serverEventBody({ name: "task_done" as never, userId: "u_1" })).toBeNull();
    vi.stubEnv("ANALYTICS_ID_SALT", "");
    expect(serverEventBody({ name: "decision_ask", userId: "u_1" })).toBeNull();
  });

  it("sends first_decision_answer beside a workspace's first decision_answer, on either side", () => {
    expect(derivedEvents("decision_answer", { via: "inbox", first_answer: true })).toEqual([["first_decision_answer", { via: "inbox" }]]);
    expect(derivedEvents("decision_answer", { via: "inbox", first_answer: false })).toEqual([]);
    expect(derivedEvents("task_move", { first_answer: true })).toEqual([]);
    vi.stubEnv("ANALYTICS_ID_SALT", "pepper");
    const first = serverEventBody({ name: "decision_answer", params: { via: "desktop", kind: "decision", first_answer: true }, userId: "u_1", tenantId: "t_1" })!;
    const events = first.events as { name: string; params: Record<string, unknown> }[];
    expect(events.map((event) => event.name)).toEqual(["decision_answer", "first_decision_answer"]);
    expect(events[1]!.params).toEqual({ via: "desktop", surface: "app", source_side: "server", engagement_time_msec: 1, workspace_hash: analyticsHash("workspace", "t_1") });
    const later = serverEventBody({ name: "decision_answer", params: { via: "desktop", first_answer: false }, userId: "u_1", tenantId: "t_1" })!;
    expect((later.events as unknown[]).length).toBe(1);
  });
});
