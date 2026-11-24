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
  /** Where it was, so the notification names it even when the one it replaces is gone. Private devices get it too, as they get it with a request. */
  workspaceName?: string;
  /** What was answered or closed: the request's question. Never to a private device. */
  question?: string;
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

/** What a `resolved` push says it is about: the request's question and its workspace, when known. */
export interface ResolvedSubject {
  workspaceName: string | null;
  question: string | null;
}

/**
 * Replaces the notification of a request closed elsewhere: "Answered by Dana", "Replaced by a new
 * question", "Closed by Scout", always with what it was about (the question, and the workspace),
 * so it reads on its own when the notification it replaces is gone. `by` is only ever a person who
 * answered, so a worker that reads only `by` never says an agent answered. A private device learns
 * only the workspace, as with a request: no names, no question.
 */
export function resolvedPayload(
  slug: string,
  requestId: string,
  { reason, by }: { reason: ResolvedReason; by: string | null },
  device: Pick<PayloadDevice, "private">,
  subject: ResolvedSubject = { workspaceName: null, question: null },
): ResolvedPayload {
  const payload: ResolvedPayload = { v: 1, type: "resolved", slug, requestId, reason };
  if (subject.workspaceName) payload.workspaceName = truncate(subject.workspaceName, NAME_CHARS);
  if (device.private) return payload;
  if (subject.question) payload.question = truncate(subject.question, QUESTION_CHARS);
  if (!by || reason === "replaced") return payload;
  return reason === "answered" ? { ...payload, by: truncate(by, NAME_CHARS) } : { ...payload, closedBy: truncate(by, NAME_CHARS) };
}
