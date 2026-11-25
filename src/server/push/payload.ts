import { askerName, type InputRequest, type RequestKind } from "@/lib/agent-sessions";
import { truncate } from "@/lib/format";

/**
 * What a push carries (docs/apps/CONTRACTS.md, "Web Push payload"): the event, never secrets nor
 * more than the Decisions page shows, under 3 KB. The service worker builds the link it opens from
 * the ids, so there is no URL in it.
 */
export const PUSH_PAYLOAD_MAX_BYTES = 3 * 1024;

/** A notification shows at most two buttons. */
export const PUSH_OPTIONS = 2;

const QUESTION_CHARS = 300;
/** The longest option a button shows; a request with a longer one gets no buttons, since a cut label could read as another answer. */
export const PUSH_OPTION_CHARS = 80;
const NAME_CHARS = 80;

export interface RequestPayload {
  v: 1;
  type: "request";
  slug: string;
  workspaceName: string;
  requestId: string;
  taskId: string;
  agentName: string;
  kind: RequestKind;
  question: string;
  options: string[];
  answerable: boolean;
  /** Set when a pipeline asked: the line, the run's number (and its name, when it has one) and the stop that holds it. */
  pipeline?: { name: string; run: number; runName?: string; stop: string };
}

export interface PrivateRequestPayload {
  v: 1;
  type: "request";
  private: true;
  slug: string;
  workspaceName: string;
  requestId: string;
  taskId: string;
}

/** Why a request's notification is replaced: a person answered it, its agent asked again, or it was closed. */
export type ResolvedReason = "answered" | "replaced" | "closed";

export interface ResolvedPayload {
  v: 1;
  type: "resolved";
  slug: string;
  requestId: string;
  reason: ResolvedReason;
  /** Who answered: only when a person did, and never to a private device. */
  by?: string;
  /** Who closed it otherwise (the agent, or a person completing the task); never to a private device. */
  closedBy?: string;
}

export type PushPayload = RequestPayload | PrivateRequestPayload | ResolvedPayload;

export interface PayloadDevice {
  answerFromNotification: boolean;
  private: boolean;
}

export interface PayloadWorkspace {
  slug: string;
  name: string;
}

const bytes = (payload: PushPayload) => Buffer.byteLength(JSON.stringify(payload), "utf8");

function privatePayload(workspace: PayloadWorkspace, taskId: string, request: Pick<InputRequest, "id">): PrivateRequestPayload {
  return { v: 1, type: "request", private: true, slug: workspace.slug, workspaceName: truncate(workspace.name, NAME_CHARS), requestId: request.id, taskId };
}

/**
 * A request's push for one device. A private device gets only "a decision is waiting in Acme".
 * Otherwise the question and who asked, and the first two options as buttons when the device
 * answers from notifications, the request takes one answer, and each button shows its whole
 * option. The question and names are cut until it fits; an option never is: buttons that would not
 * fit are left off.
 */
export function requestPayload(workspace: PayloadWorkspace, taskId: string, request: InputRequest, device: PayloadDevice): RequestPayload | PrivateRequestPayload {
  if (device.private) return privatePayload(workspace, taskId, request);
  // Only a button's label: the answer itself is read from the request by its index.
  const buttons = request.options.slice(0, PUSH_OPTIONS);
  const answerable = device.answerFromNotification && !request.multiple && buttons.length > 0 && buttons.every((option) => option.length <= PUSH_OPTION_CHARS);
  for (const withButtons of answerable ? [true, false] : [false]) {
    for (let scale = 1; scale >= 1 / 16; scale /= 2) {
      const payload: RequestPayload = {
        v: 1,
        type: "request",
        slug: workspace.slug,
        workspaceName: truncate(workspace.name, Math.ceil(NAME_CHARS * scale)),
        requestId: request.id,
        taskId,
        agentName: truncate(askerName(request), Math.ceil(NAME_CHARS * scale)),
        kind: request.kind,
        question: truncate(request.question, Math.ceil(QUESTION_CHARS * scale)),
        options: withButtons ? buttons : [],
        answerable: withButtons,
        ...(request.pipeline && {
          pipeline: {
            name: truncate(request.pipeline.pipelineName, Math.ceil(NAME_CHARS * scale)),
            run: request.pipeline.runNumber,
            ...(request.pipeline.runName && { runName: truncate(request.pipeline.runName, Math.ceil(NAME_CHARS * scale)) }),
            stop: truncate(request.pipeline.stopName, Math.ceil(NAME_CHARS * scale)),
          },
        }),
      };
      if (bytes(payload) <= PUSH_PAYLOAD_MAX_BYTES) return payload;
    }
  }
  return privatePayload(workspace, taskId, request);
}

/** Why the event that closed a request closed it. */
export function resolvedReason(action: string | undefined): ResolvedReason {
  if (action === "task.input_answered") return "answered";
  if (action === "task.input_requested") return "replaced";
  return "closed";
}

/**
 * Replaces the notification of a request closed elsewhere: "Answered by Dana", "Replaced by a new
 * question", "Closed by Scout". `by` is only ever a person who answered, so a worker that reads
 * only `by` never says an agent answered. A private device learns no names.
 */
export function resolvedPayload(slug: string, requestId: string, { reason, by }: { reason: ResolvedReason; by: string | null }, device: Pick<PayloadDevice, "private">): ResolvedPayload {
  const payload: ResolvedPayload = { v: 1, type: "resolved", slug, requestId, reason };
  if (device.private || !by || reason === "replaced") return payload;
  return reason === "answered" ? { ...payload, by: truncate(by, NAME_CHARS) } : { ...payload, closedBy: truncate(by, NAME_CHARS) };
}

