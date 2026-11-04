import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { LINK_KINDS, REQUEST_KINDS } from "@/lib/agent-sessions";
import { AskInput, MAX_WAIT_SECONDS, WaitForAnswersInput } from "@/server/domain/schemas";
import { TOOLS } from "@/server/mcp/tools";
import { backoffSeconds, MAX_CONSECUTIVE_FAILURES, REQUEST_TIMEOUT_MS } from "@/server/webhooks/dispatch";
import { SIGNATURE_HEADER, signPayload, verifySignature } from "@/server/webhooks/signing";

const read = (name: string) => readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");
const SKILLS = { "phean-decisions": read("phean-decisions"), "phean-webhooks": read("phean-webhooks") };
const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));
/** Delivery reasons look like tool names (snake_case) but are payload values. */
const REASONS = ["asked_by_you", "in_watched_goal", "about_watched_task"];

const codeBlock = (skill: string, language: string) => new RegExp("```" + language + "\\n([\\s\\S]+?)\\n```").exec(skill)![1]!;

describe.each(Object.entries(SKILLS))("the %s skill", (name, skill) => {
  it("has the frontmatter clients load skills by", () => {
    const frontmatter = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(skill);
    expect(frontmatter?.[1]).toBe(name);
    expect(frontmatter?.[2]!.length).toBeGreaterThan(100);
  });

  it("names only tools the server has", () => {
    // Inline code that looks like a tool name (snake_case with an underscore).
    const named = [...skill.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((match) => match[1]!).filter((value) => !REASONS.includes(value));
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
