import { describe, expect, it } from "vitest";

import { DEFAULT_WORKFLOW, inFlowOrder, normalizeWorkflow, type Stage } from "@/lib/workflow";

const stage = (key: string, kind: Stage["kind"]): Stage => ({ key, label: key, kind, hidden: false });

describe("lane order", () => {
  it("runs the default lanes from Inbox to Done, with Backlog after Done", () => {
    expect(DEFAULT_WORKFLOW.map((lane) => lane.key)).toEqual(["inbox", "todo", "in_progress", "done", "backlog"]);
  });

  it("puts added stages with their kind and keeps the workspace's order within it", () => {
    const stages = [stage("backlog", "backlog"), stage("someday", "backlog"), stage("done", "done"), stage("review", "in_progress"), stage("in_progress", "in_progress"), stage("todo", "todo"), stage("inbox", "inbox")];
    expect(inFlowOrder(stages).map((lane) => lane.key)).toEqual(["inbox", "todo", "review", "in_progress", "done", "backlog", "someday"]);
  });

  it("reorders a workflow saved in the old order when it is read", () => {
    const saved = ["inbox", "backlog", "todo", "in_progress", "done"].map((kind) => stage(kind, kind as Stage["kind"]));
    expect(normalizeWorkflow(saved).map((lane) => lane.key)).toEqual(["inbox", "todo", "in_progress", "done", "backlog"]);
  });
});
