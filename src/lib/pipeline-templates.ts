/**
 * Starting points for a pipeline a person makes by hand (most are defined by agents). Each is a
 * whole, valid definition whose agent stops are "any agent", so it runs in any workspace; the editor
 * then names the agents and people. Client-safe: the New pipeline panel lists them and the server
 * defines from the chosen one.
 */
import type { PipelineDefinition, PipelineStop } from "./pipelines";

export const PIPELINE_TEMPLATES = ["research_send", "triage_verify", "blank"] as const;
export type PipelineTemplate = (typeof PIPELINE_TEMPLATES)[number];

const stop = (id: string, name: string, then: PipelineStop["then"], extra: Partial<PipelineStop> = {}): PipelineStop => ({
  id,
  name,
  kind: "any_agent",
  approvals: 1,
  options: [],
  blocking: true,
  instructions: "",
  outputs: [],
  onFailure: { action: "fail", times: 1 },
  then,
  ...extra,
});

export const PIPELINE_TEMPLATE_META: Record<PipelineTemplate, { label: string; hint: string; definition: PipelineDefinition }> = {
  research_send: {
    label: "Research, draft, review, send",
    hint: "An agent researches and drafts, a person approves, an agent sends.",
    definition: {
      start: "research",
      inputs: [{ name: "topic", description: "What it is about", required: false }],
      stops: [
        stop("research", "Research", { next: "draft" }, { instructions: "Research {{input.topic}} and hand on the sources worth reading.", outputs: ["a list of sources"] }),
        stop("draft", "Draft", { next: "review" }, { instructions: "Draft it from the research: {{stops.research.result}}", outputs: ["a draft document"], onFailure: { action: "retry", times: 1 } }),
        stop("review", "Review", { choice: [{ label: "Approve", to: "send" }, { label: "Drop", end: "dropped" }] }, {
          kind: "person",
          role: "member",
          options: ["Approve", "Drop"],
          instructions: "Approve the draft for sending?",
          timeLimitMinutes: 60 * 24,
          onTimeout: "Drop",
        }),
        stop("send", "Send", { end: "sent" }, { instructions: "Send the approved draft." }),
      ],
      ends: [
        { id: "sent", name: "Sent" },
        { id: "dropped", name: "Dropped by review" },
      ],
    },
  },
  triage_verify: {
    label: "Triage, fix, verify",
    hint: "An agent triages and fixes, a person checks the fix.",
    definition: {
      start: "triage",
      inputs: [{ name: "issue", description: "The issue, or a link to it", required: false }],
      stops: [
        stop("triage", "Triage", { next: "fix" }, { instructions: "Find the cause of {{input.issue}} and say how to fix it." }),
        stop("fix", "Fix", { next: "verify" }, { instructions: "Fix it: {{stops.triage.result}}", outputs: ["the change, linked"], onFailure: { action: "hand_back", times: 1 } }),
        stop("verify", "Verify", { choice: [{ label: "Fixed", end: "fixed" }, { label: "Not fixed", end: "reopened" }] }, {
          kind: "person",
          role: "member",
          options: ["Fixed", "Not fixed"],
          instructions: "Is it fixed?",
        }),
      ],
      ends: [
        { id: "fixed", name: "Fixed" },
        { id: "reopened", name: "Reopened" },
      ],
    },
  },
  blank: {
    label: "One stop",
    hint: "A single stop for any agent; add the rest in the editor.",
    definition: {
      start: "first",
      inputs: [],
      stops: [stop("first", "First stop", { end: "done" })],
      ends: [{ id: "done", name: "Done" }],
    },
  },
};
