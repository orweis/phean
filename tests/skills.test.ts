import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { LINK_KINDS, REQUEST_KINDS } from "@/lib/agent-sessions";
import { DOCUMENT_FORMATS } from "@/lib/documents";
import { DEFINABLE_PIPELINE_KINDS, DELEGATION_STATES, FAILURE_ACTIONS, JOIN_MODES, STOP_KINDS, STOP_STATES } from "@/lib/domain";
import { EVENT_INPUTS } from "@/server/domain/pipeline-engine";
import {
  AskInput,
  AttachDocumentInput,
  DefinePipelineInput,
  FailureRuleInput,
  HandOffInput,
  ListTasksInput,
  MAX_WAIT_SECONDS,
  PipelineStopInput,
  PipelineTriggersInput,
  RegisterWebhookInput,
  RerunFromInput,
  StartRunInput,
  StopThenInput,
  WaitForAnswersInput,
} from "@/server/domain/schemas";
import { SERVER_INSTRUCTIONS } from "@/server/mcp/guidance";
import { TOOLS } from "@/server/mcp/tools";
import { AGENT_INACTIVE, backoffSeconds, MAX_CONSECUTIVE_FAILURES, REQUEST_TIMEOUT_MS } from "@/server/webhooks/dispatch";
import { SIGNATURE_HEADER, signPayload, verifySignature } from "@/server/webhooks/signing";

const read = (name: string) => readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");
const SKILLS = {
  "phean-decisions": read("phean-decisions"),
  "phean-webhooks": read("phean-webhooks"),
  "phean-documents": read("phean-documents"),
  "phean-handoffs": read("phean-handoffs"),
  "phean-pipelines": read("phean-pipelines"),
};
const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));
/** Delivery reasons and the delivery error look like tool names (snake_case) but are payload values. */
const REASONS = ["asked_by_you", "handed_to_you", "handed_off_by_you", "in_watched_goal", "about_watched_task", AGENT_INACTIVE];
/** Field values that also look like tool names: the delegation states, the handed_to_me filter, and pipelines' kinds, states and event inputs. */
const VALUES = [...REASONS, ...DELEGATION_STATES, "handed_to_me", "handed_off_by_me", ...STOP_KINDS, ...FAILURE_ACTIONS, ...STOP_STATES, ...EVENT_INPUTS];

const codeBlock = (skill: string, language: string) => new RegExp("```" + language + "\\n([\\s\\S]+?)\\n```").exec(skill)![1]!;

describe.each(Object.entries(SKILLS))("the %s skill", (name, skill) => {
  it("has the frontmatter clients load skills by", () => {
    const frontmatter = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(skill);
    expect(frontmatter?.[1]).toBe(name);
    expect(frontmatter?.[2]!.length).toBeGreaterThan(100);
  });

  it("names only tools the server has", () => {
    // Inline code that looks like a tool name (snake_case with an underscore).
    const named = [...skill.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((match) => match[1]!).filter((value) => !VALUES.includes(value));
    expect(named.length).toBeGreaterThan(3);
    expect(named.filter((value) => !TOOL_NAMES.has(value))).toEqual([]);
  });
});

describe("the phean-decisions skill", () => {
  const SKILL = SKILLS["phean-decisions"];

  it("uses the request and link kinds, fields and limits the server accepts", () => {
    for (const kind of [...REQUEST_KINDS, ...LINK_KINDS]) expect(SKILL).toContain(`\`${kind}\``);
    for (const field of Object.keys(AskInput.shape)) expect(SKILL).toContain(`\`${field}\``);
    expect(SKILL).toContain(`the maximum is ${MAX_WAIT_SECONDS}`);
    expect(SKILL).toContain(`the default (${WaitForAnswersInput.shape.timeoutSeconds.parse(undefined)})`);
  });

  it("carries an example request the server would accept", () => {
    const example = JSON.parse(codeBlock(SKILL, "json"));
    expect(AskInput.safeParse(example).success).toBe(true);
  });
});

describe("links in the skills", () => {
  it("teaches agents to share the links Phean returns", () => {
    expect(SKILLS["phean-decisions"]).toContain("inputRequest.url");
    expect(SKILLS["phean-handoffs"]).toContain("linkTemplate");
    expect(SKILLS["phean-documents"]).toContain("Documents listed on a task (`get_task`) carry their `url`");
  });
});

describe("the phean-handoffs skill", () => {
  const SKILL = SKILLS["phean-handoffs"];

  it("names every delegation state, every handoff field, and the filter that finds handoffs", () => {
    for (const state of DELEGATION_STATES) expect(SKILL).toContain(`\`${state}\``);
    for (const field of Object.keys(HandOffInput.shape)) expect(SKILL).toContain(`\`${field}\``);
    expect(ListTasksInput.shape.claimed.parse("handed_to_me")).toBe("handed_to_me");
    expect(SKILL).toContain("`handed_to_me`");
    expect(SKILL).toContain("`handed_to_you`");
    expect(ListTasksInput.shape.claimed.parse("handed_off_by_me")).toBe("handed_off_by_me");
    expect(SKILL).toContain("`handed_off_by_me`");
    expect(SKILL).toContain("`handed_off_by_you`");
  });

  it("teaches family claims and claim transfers, as the server's guidance does", () => {
    for (const text of [SKILL, SERVER_INSTRUCTIONS]) {
      expect(text).toContain("task.claim_transferred");
      expect(text).toContain("collect_answers");
      expect(text).toMatch(/family shares its claims/);
    }
  });

  it("carries an example handoff and hand-back the server would accept", () => {
    const examples = [...SKILL.matchAll(/```json\n([\s\S]+?)\n```/g)].map((match) => JSON.parse(match[1]!) as Record<string, unknown>);
    expect(examples).toHaveLength(2);
    for (const example of examples) expect(HandOffInput.safeParse(example).success).toBe(true);
    expect(examples.map((example) => Boolean(example.handBack))).toEqual([false, true]);
    expect(HandOffInput.safeParse({ ...examples[1], toAgent: "Builder agent" }).success).toBe(false);
  });

  it("teaches handing finished work back by default, as the server's guidance does", () => {
    for (const text of [SKILL, SERVER_INSTRUCTIONS]) {
      expect(text).toMatch(/handBack: true/);
      expect(text).toContain("handedOffBy");
      expect(text).toContain("forAgents");
    }
  });
});

describe("the phean-documents skill", () => {
  const SKILL = SKILLS["phean-documents"];

  it("names every format and field the server accepts", () => {
    for (const format of DOCUMENT_FORMATS) expect(SKILL).toContain(`\`${format}\``);
    for (const field of Object.keys(AttachDocumentInput.shape)) expect(SKILL).toContain(`\`${field}\``);
    expect(SKILL).toContain("`expectedVersion`");
  });

  it("carries an example document the server would accept", () => {
    const example = JSON.parse(codeBlock(SKILL, "json"));
    expect(AttachDocumentInput.safeParse(example).success).toBe(true);
  });
});

describe("the phean-webhooks skill", () => {
  const SKILL = SKILLS["phean-webhooks"];
  const secret = "whsec_skill-test-secret";
  const body = JSON.stringify({ type: "phean.events", events: [{ eventId: 1, action: "task.input_answered", summary: "Dana answered “Pick the auditor” ✓" }] });
  const now = Date.now();
  const timestamp = Math.floor(now / 1000);
  /** What a receiver must accept and refuse, signed by the server's own code. */
  const cases: [string, string, string, number, boolean][] = [
    ["a valid request", body, signPayload(secret, body, timestamp), now, true],
    ["a tampered body", `${body} `, signPayload(secret, body, timestamp), now, false],
    ["another secret", body, signPayload("whsec_other", body, timestamp), now, false],
    ["a replayed request", body, signPayload(secret, body, timestamp - 301), now, false],
    ["a garbled header", body, "t=abc,v1=zz", now, false],
    ["a missing header", body, "", now, false],
  ];

  it("documents the signature the server sends", () => {
    expect(SKILL).toContain(SIGNATURE_HEADER);
    expect(SKILL).toContain("**300 seconds**");
    for (const [, payload, header, at, valid] of cases) expect(verifySignature(secret, payload, header, { now: at, toleranceSeconds: 300 })).toBe(valid);
  });

  it("shows a registration with endpoint headers the server would accept", () => {
    expect(RegisterWebhookInput.safeParse(JSON.parse(codeBlock(SKILL, "json"))).success).toBe(true);
    for (const field of Object.keys(RegisterWebhookInput.shape)) expect(SKILL).toContain(`\`${field}\``);
  });

  it("quotes the server's delivery limits", () => {
    expect(SKILL).toContain(`After ${MAX_CONSECUTIVE_FAILURES} failures in a row`);
    expect(SKILL).toContain(`waits at most ${REQUEST_TIMEOUT_MS / 1000} seconds`);
    expect(SKILL).toContain(`(${backoffSeconds(1)} s, ${backoffSeconds(2) / 60} min, ${backoffSeconds(3) / 60} min, … up to every ${backoffSeconds(99) / 3600} h)`);
    for (const reason of [...REASONS, "watching:task", "workspace"]) expect(SKILL).toContain(`\`${reason}\``);
  });

  it("carries a Node verifier that accepts Phean's signatures and nothing else", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "phean-skill-")), "verify.mjs");
    writeFileSync(file, codeBlock(SKILL, "js"));
    const { verifyPhean } = (await import(pathToFileURL(file).href)) as { verifyPhean: (...args: unknown[]) => boolean };
    for (const [label, payload, header, at, valid] of cases) {
      expect(verifyPhean(secret, payload, header, at), label).toBe(valid);
      expect(verifyPhean(secret, Buffer.from(payload), header, at), `${label} (Buffer)`).toBe(valid);
    }
  });

  const python = spawnSync("python3", ["--version"]).status === 0;
  it.skipIf(!python)("carries a Python verifier that accepts Phean's signatures and nothing else", () => {
    const script = `${codeBlock(SKILL, "python")}

import json, sys
cases = json.loads(sys.stdin.read())
print(json.dumps([verify_phean(${JSON.stringify(secret)}, body.encode(), header, now=at / 1000) for body, header, at in cases]))
`;
    const run = spawnSync("python3", ["-I", "-c", script], { input: JSON.stringify(cases.map(([, payload, header, at]) => [payload, header, at])), encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(JSON.parse(run.stdout)).toEqual(cases.map(([, , , , valid]) => valid));
  });
});

describe("the phean-pipelines skill", () => {
  const SKILL = SKILLS["phean-pipelines"];
  const PIPELINE_TOOLS = ["define_pipeline", "update_pipeline", "list_pipelines", "get_pipeline", "start_run", "get_run", "list_runs", "cancel_run", "rerun_from"];

  it("names every pipeline tool, and each is one the server has", () => {
    for (const tool of PIPELINE_TOOLS) {
      expect(TOOL_NAMES.has(tool), tool).toBe(true);
      expect(SKILL).toContain(`\`${tool}\``);
    }
  });

  it("names every field, kind, rule, join and state the server accepts", () => {
    const fields = [DefinePipelineInput, PipelineStopInput, StopThenInput, FailureRuleInput, PipelineTriggersInput, StartRunInput, RerunFromInput].flatMap((schema) => Object.keys(schema.shape));
    for (const field of fields) expect(SKILL, field).toContain(`\`${field}\``);
    for (const value of [...DEFINABLE_PIPELINE_KINDS, ...STOP_KINDS, ...FAILURE_ACTIONS, ...JOIN_MODES, ...STOP_STATES, "upcoming", ...EVENT_INPUTS]) expect(SKILL, value).toContain(`\`${value}\``);
  });

  it("carries an example definition the server would accept", () => {
    const example = JSON.parse(codeBlock(SKILL, "json"));
    const parsed = DefinePipelineInput.safeParse(example);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.data?.definition.stops.map((stop) => stop.kind)).toEqual(expect.arrayContaining(["agent", "person"]));
  });

  it("teaches designing, changing and following a pipeline, as the server's guidance does", () => {
    for (const heading of ["## Designing a pipeline", "## Changing a pipeline", "## Running and following", "## Left to people"]) expect(SKILL).toContain(heading);
    for (const text of [SKILL, SERVER_INSTRUCTIONS]) {
      for (const tool of ["list_pipelines", "get_pipeline", "update_pipeline", "rerun_from", "request_input"]) expect(text, tool).toContain(tool);
      expect(text).toMatch(/proposal/);
    }
    for (const other of ["phean-handoffs", "phean-decisions", "phean-webhooks"] as const) expect(SKILLS[other], other).toContain("phean-pipelines");
  });

  it("teaches finishing a stop with a result rather than handing it on, as the server's guidance does", () => {
    for (const text of [SKILL, SERVER_INSTRUCTIONS]) {
      expect(text).toMatch(/Do not hand it on yourself/);
      expect(text).toContain("complete_task");
      expect(text).toContain("handBack: true");
      expect(text).toContain("phean-pipelines");
    }
  });
});
