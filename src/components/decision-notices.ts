import { retractAnswerAction } from "@/app/w/[slug]/actions";
import type { InputRequest } from "@/lib/agent-sessions";
import { truncate } from "@/lib/format";

import type { UndoSpec } from "./ui/status-region";

/** A request named in a notice by its question: the notice outlives the row it was about. */
export const askedAbout = (request: Pick<InputRequest, "question">) => `“${truncate(request.question, 60)}”`;

/** Taking the answer back reopens the question, until the agent has collected it. */
export const takeBack = (taskId: string, request: Pick<InputRequest, "id" | "question">): UndoSpec => ({
  action: retractAnswerAction,
  fields: { taskId, requestId: request.id },
  done: `${askedAbout(request)} is open again.`,
});
