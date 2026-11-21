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
const OPTION_CHARS = 80;
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

export interface ResolvedPayload {
  v: 1;
  type: "resolved";
  slug: string;
  requestId: string;
  by: string;
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
 * answers from notifications and the request takes one answer. Text is cut until it fits.
 */
export function requestPayload(workspace: PayloadWorkspace, taskId: string, request: InputRequest, device: PayloadDevice): RequestPayload | PrivateRequestPayload {
  if (device.private) return privatePayload(workspace, taskId, request);
  const answerable = device.answerFromNotification && !request.multiple && request.options.length > 0;
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
      // Only a button's label: the answer itself is read from the request by its index.
      options: answerable ? request.options.slice(0, PUSH_OPTIONS).map((option) => truncate(option, Math.ceil(OPTION_CHARS * scale))) : [],
      answerable,
    };
    if (bytes(payload) <= PUSH_PAYLOAD_MAX_BYTES) return payload;
  }
  return privatePayload(workspace, taskId, request);
}

/** Replaces the notification of a request closed elsewhere: "Answered by Dana". */
export function resolvedPayload(slug: string, requestId: string, by: string): ResolvedPayload {
  return { v: 1, type: "resolved", slug, requestId, by: truncate(by, NAME_CHARS) };
}
