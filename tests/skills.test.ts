import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LINK_KINDS, REQUEST_KINDS } from "@/lib/agent-sessions";
import { AskInput, MAX_WAIT_SECONDS, WaitForAnswersInput } from "@/server/domain/schemas";
import { TOOLS } from "@/server/mcp/tools";

const SKILL = readFileSync(new URL("../skills/phean-decisions/SKILL.md", import.meta.url), "utf8");
const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));

describe("the phean-decisions skill", () => {
  it("has the frontmatter clients load skills by", () => {
    const frontmatter = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(SKILL);
    expect(frontmatter?.[1]).toBe("phean-decisions");
    expect(frontmatter?.[2]!.length).toBeGreaterThan(100);
  });

  it("names only tools the server has", () => {
    // Inline code that looks like a tool name (snake_case with an underscore).
    const named = [...SKILL.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((match) => match[1]!);
    expect(named.length).toBeGreaterThan(5);
    expect(named.filter((name) => !TOOL_NAMES.has(name))).toEqual([]);
  });

  it("uses the request and link kinds, fields and limits the server accepts", () => {
    for (const kind of [...REQUEST_KINDS, ...LINK_KINDS]) expect(SKILL).toContain(`\`${kind}\``);
    for (const field of Object.keys(AskInput.shape)) expect(SKILL).toContain(`\`${field}\``);
    expect(SKILL).toContain(`the maximum is ${MAX_WAIT_SECONDS}`);
    expect(SKILL).toContain(`the default (${WaitForAnswersInput.shape.timeoutSeconds.parse(undefined)})`);
  });

  it("carries an example request the server would accept", () => {
    const example = JSON.parse(/```json\n([\s\S]+?)\n```/.exec(SKILL)![1]!);
    expect(AskInput.safeParse(example).success).toBe(true);
  });
});
