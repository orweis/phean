import { describe, expect, it } from "vitest";

import {
  answerCall,
  answeredNotification,
  answerFailedNotification,
  isOfflineAsset,
  isPageNavigation,
  notificationFor,
  quotedSubject,
  notificationUrl,
  offlineAssets,
  optionIndexOf,
  parsePushPayload,
  readNotificationData,
  undoCall,
  undoFailedNotification,
  undoneNotification,
  type RequestPush,
} from "@/lib/push";
import { APP_ICON_SIZES, routes } from "@/lib/routes";

const ORIGIN = "https://phean.example";

const REQUEST = {
  v: 1,
  type: "request",
  slug: "acme",
  workspaceName: "Acme",
  requestId: "q_abc123",
  taskId: "t_def456",
  agentName: "Scout",
  kind: "decision",
  question: "Which auditor?",
  options: ["Okafor", "Lindqvist"],
  answerable: true,
};

const parsed = (payload: unknown) => parsePushPayload(JSON.stringify(payload));
const request = () => parsed(REQUEST) as RequestPush;

describe("parsePushPayload", () => {
  it("reads the three payloads of the contract", () => {
    expect(request()).toMatchObject({ type: "request", private: false, slug: "acme", requestId: "q_abc123", taskId: "t_def456", options: ["Okafor", "Lindqvist"], answerable: true });
    expect(parsed({ v: 1, type: "request", private: true, slug: "acme", workspaceName: "Acme", requestId: "q_abc123", taskId: "t_def456" })).toEqual({
      type: "request",
      private: true,
      slug: "acme",
      workspaceName: "Acme",
      requestId: "q_abc123",
      taskId: "t_def456",
    });
    expect(parsed({ v: 1, type: "resolved", slug: "acme", requestId: "q_abc123", reason: "answered", by: "Dana" })).toEqual({
      type: "resolved",
      slug: "acme",
      requestId: "q_abc123",
      reason: "answered",
      by: "Dana",
      closedBy: null,
      workspaceName: null,
      question: null,
    });
    expect(parsed({ v: 1, type: "resolved", slug: "acme", requestId: "q_abc123", reason: "closed", closedBy: "Scout", workspaceName: "Acme", question: "Which auditor?" })).toMatchObject({
      workspaceName: "Acme",
      question: "Which auditor?",
    });
    // From a server older than the reason, and with a reason this worker does not know.
    expect(parsed({ v: 1, type: "resolved", slug: "acme", requestId: "q_abc123", by: "Dana" })).toMatchObject({ reason: null, by: "Dana" });
    expect(parsed({ v: 1, type: "resolved", slug: "acme", requestId: "q_abc123", reason: "exploded" })).toMatchObject({ reason: null, by: null });
  });

  it("keeps at most two options, and refuses what it cannot trust", () => {
    expect(parsed({ ...REQUEST, options: ["a", "b", "c"] })).toMatchObject({ options: ["a", "b"] });
    expect(parsePushPayload("not json")).toBeNull();
    expect(parsePushPayload(null)).toBeNull();
    expect(parsed({ ...REQUEST, v: 2 })).toBeNull();
    expect(parsed({ ...REQUEST, type: "other" })).toBeNull();
    expect(parsed({ ...REQUEST, slug: "../evil" })).toBeNull();
    expect(parsed({ ...REQUEST, slug: "a/b" })).toBeNull();
    expect(parsed({ ...REQUEST, slug: ".." })).toBeNull();
    expect(parsed({ ...REQUEST, requestId: "t_abc" })).toBeNull();
    expect(parsed({ ...REQUEST, taskId: "q_abc" })).toBeNull();
    expect(parsed({ ...REQUEST, requestId: "q_a/b" })).toBeNull();
  });
});

describe("notificationFor", () => {
  it("shows a request with its question, tagged with the request id, and buttons when answerable", () => {
    const { title, options } = notificationFor(request());
    // Plainly the agent's words, whatever they say.
    expect(title).toBe("Scout asks · Acme");
    expect(options).toMatchObject({ tag: "q_abc123", body: "Which auditor?", actions: [{ action: "option-0", title: "Okafor" }, { action: "option-1", title: "Lindqvist" }] });
    expect(options.data).toMatchObject({ slug: "acme", requestId: "q_abc123", taskId: "t_def456" });
  });

  it("keeps the colourful icon large and gives the status bar a monochrome badge for the kind", () => {
    const asked = notificationFor(request());
    expect(asked.options.icon).toBe(routes.appIcon(APP_ICON_SIZES[0]));
    expect(asked.options.badge).toBe(routes.notificationBadge("request"));
    expect(asked.options.badge).not.toBe(asked.options.icon);
    const settled = notificationFor(parsed({ v: 1, type: "resolved", slug: "acme", requestId: "q_abc123", by: "Dana" }), asked.options.data);
    expect(settled.options.badge).toBe(routes.notificationBadge("resolved"));
    expect(notificationFor(null).options.badge).toBe(routes.notificationBadge("request"));
  });

  it("shows no buttons when the device may not answer from notifications", () => {
    expect(notificationFor(parsed({ ...REQUEST, answerable: false })).options.actions).toEqual([]);
    expect(notificationFor(parsed({ ...REQUEST, options: [] })).options.actions).toEqual([]);
  });

  it("says only where on a private device", () => {
    const shown = notificationFor(parsed({ v: 1, type: "request", private: true, slug: "acme", workspaceName: "Acme", requestId: "q_abc123", taskId: "t_def456" }));
    expect(shown.title).toBe("A decision is waiting in Acme");
    expect(shown.options.body).toBeUndefined();
    expect(shown.options.actions).toEqual([]);
    expect(JSON.stringify(shown)).not.toContain("auditor");
  });

  it("replaces the request's notification when it was answered elsewhere, naming the question and the workspace", () => {
    const previous = notificationFor(request()).options.data;
    const shown = notificationFor(parsed({ v: 1, type: "resolved", slug: "acme", requestId: "q_abc123", by: "Dana" }), previous);
    expect(shown).toMatchObject({ title: "Answered by Dana · Acme", options: { tag: "q_abc123", body: "Which auditor?", actions: [], silent: true } });
    // From an older server with nothing left to replace, it says what it can.
    expect(notificationFor(parsed({ v: 1, type: "resolved", slug: "acme", requestId: "q_abc123" })).title).toBe("Answered elsewhere");
  });

  it("names what was closed even when the notification it replaces is gone", () => {
    const resolved = (extra: object) => notificationFor(parsed({ v: 1, type: "resolved", slug: "acme", requestId: "q_abc123", workspaceName: "Acme", ...extra }));
    expect(resolved({ reason: "closed", closedBy: "Scout", question: "Which auditor?" })).toMatchObject({ title: "Closed by Scout · Acme", options: { body: "Which auditor?" } });
    expect(resolved({ reason: "answered", by: "Dana", question: "Which bank?" })).toMatchObject({ title: "Answered by Dana · Acme", options: { body: "Which bank?" } });
    expect(resolved({ reason: "replaced", question: "Which auditor?" })).toMatchObject({ title: "Replaced by a new question · Acme", options: { body: "Which auditor?" } });
    // A private device gets the workspace only: the workspace is the subject.
    expect(resolved({ reason: "closed" })).toMatchObject({ title: "A decision in Acme was closed", options: { body: undefined } });
    expect(resolved({ reason: "answered" }).title).toBe("A decision in Acme was answered");
    expect(resolved({ reason: "replaced" }).title).toBe("A decision in Acme was replaced by a new question");
  });

  it("never says an agent answered: its new question replaced the old one, or it closed it", () => {
    const previous = notificationFor(request()).options.data;
    const resolved = (extra: object) => notificationFor(parsed({ v: 1, type: "resolved", slug: "acme", requestId: "q_abc123", ...extra }), previous);
    expect(resolved({ reason: "replaced" })).toMatchObject({ title: "Replaced by a new question · Acme", options: { body: "Which auditor?", silent: true } });
    expect(resolved({ reason: "closed", closedBy: "Scout" }).title).toBe("Closed by Scout · Acme");
    expect(resolved({ reason: "closed" }).title).toBe("Closed · Acme");
    expect(resolved({ reason: "answered", by: "Dana" }).title).toBe("Answered by Dana · Acme");
    // A `by` is only a person's: even sent with another reason, it is not read as one.
    expect(resolved({ reason: "replaced", by: "Scout" }).title).toBe("Replaced by a new question · Acme");
  });

  it("still shows something for a payload it cannot read, as Chrome requires", () => {
    expect(notificationFor(null)).toMatchObject({ title: "Phean", options: { data: null, actions: [] } });
  });
});

describe("notificationUrl", () => {
  it("opens the request on its Decisions page, built from the ids", () => {
    const data = notificationFor(request()).options.data;
    expect(notificationUrl(data, ORIGIN)).toBe(`${ORIGIN}${routes.request("acme", "q_abc123")}`);
  });

  it("never leaves the origin, whatever the data says", () => {
    expect(notificationUrl(null, ORIGIN)).toBe(`${ORIGIN}/workspaces`);
    expect(notificationUrl({ slug: "//evil.example", requestId: "q_a", taskId: null, request: null }, ORIGIN)).toBe(`${ORIGIN}/workspaces`);
    expect(notificationUrl(readNotificationData({ slug: "acme", requestId: "q_a", url: "https://evil.example" }), ORIGIN)).toBe(`${ORIGIN}${routes.request("acme", "q_a")}`);
  });
});

describe("answering from a notification", () => {
  const data = () => notificationFor(request()).options.data!;

  it("posts the option's index and the ids, never its label", () => {
    expect(optionIndexOf("option-1")).toBe(1);
    expect(optionIndexOf("option-2")).toBeNull();
    expect(optionIndexOf("")).toBeNull();
    expect(answerCall(data(), 1)).toEqual({ path: routes.pushAnswer("acme"), body: { taskId: "t_def456", requestId: "q_abc123", option: 1 } });
    expect(answerCall(data(), 2)).toBeNull();
    expect(answerCall({ ...data(), request: null }, 0)).toBeNull();
    // With this device's endpoint, so only the person's other devices are told.
    expect(answerCall(data(), 0, "https://fcm.googleapis.com/fcm/send/abc")).toEqual({
      path: routes.pushAnswer("acme"),
      body: { taskId: "t_def456", requestId: "q_abc123", option: 0, endpoint: "https://fcm.googleapis.com/fcm/send/abc" },
    });
    expect(undoCall(data(), "https://fcm.googleapis.com/fcm/send/abc")?.body).toMatchObject({ endpoint: "https://fcm.googleapis.com/fcm/send/abc" });
  });


  it("says what it sent and to whom, with Undo", () => {
    const sent = answeredNotification(data(), { answer: "Okafor", taskTitle: "Pick the auditor", agentName: "Scout" });
    expect(sent).toMatchObject({ title: "Sent “Okafor” to Scout", options: { tag: "q_abc123", body: "Which auditor?", actions: [{ action: "undo", title: "Undo" }] } });
    expect(undoCall(sent.options.data)).toEqual({ path: routes.pushUndo("acme"), body: { taskId: "t_def456", requestId: "q_abc123" } });
  });

  it("says when the request was already answered, or the answer did not go", () => {
    expect(answerFailedNotification(data(), 409)).toMatchObject({ title: "Already answered", options: { body: "“Which auditor?” was answered or replaced before your answer arrived." } });
    expect(answerFailedNotification(data(), 409, "Dana answered first.").options.body).toBe("Dana answered first.");
    expect(answerFailedNotification(data(), 401)).toMatchObject({ title: "Sign in to answer", options: { body: "Open Phean on this device to sign in again, then answer “Which auditor?”." } });
    expect(answerFailedNotification(data(), 500)).toMatchObject({ title: "Your answer was not sent", options: { body: "Open “Which auditor?” to answer it in Phean.", actions: [] } });
  });

  it("shows the request again after Undo, and says when Undo is too late", () => {
    expect(undoneNotification(data()).options.actions).toHaveLength(2);
    expect(undoFailedNotification(data(), 409)).toMatchObject({ title: "Too late to undo", options: { body: "Scout already has your answer to “Which auditor?”." } });
    expect(undoFailedNotification(data(), 500)).toMatchObject({ title: "Undo did not go through", options: { body: "Open “Which auditor?” to change your answer in Phean." } });
  });

  it("cuts a long question to fit, never the words around it", () => {
    const long = "Which of the auditors on the shortlist should run the year-end audit for the European subsidiaries next spring?";
    const subject = quotedSubject(long);
    expect(subject.length).toBeLessThanOrEqual(82);
    expect(subject.endsWith("…”")).toBe(true);
    expect(quotedSubject("Which auditor?")).toBe("“Which auditor?”");
  });

  it("reads back only data it can trust", () => {
    expect(readNotificationData(data())).toEqual(data());
    expect(readNotificationData({ slug: "acme" })).toBeNull();
    expect(readNotificationData({ ...data(), request: { ...REQUEST, requestId: "q_other" } })?.request).toBeNull();
  });
});

describe("the offline cache", () => {
  it("keeps only the offline page's stylesheets and fonts", () => {
    const html = `<html><head>
      <link rel="stylesheet" href="/_next/static/css/app.css" data-precedence="next"/>
      <link rel="preload" href="/_next/static/media/font.woff2" as="font" crossorigin="" type="font/woff2"/>
      <link rel="preload" as="script" href="/_next/static/chunks/main.js"/>
      <link rel="icon" href="/icon.svg"/>
      <link rel="stylesheet" href="https://cdn.example/x.css"/>
      <link rel="stylesheet" href="/_next/static/../../secret.css"/>
    </head></html>`;
    expect(offlineAssets(html)).toEqual(["/_next/static/css/app.css", "/_next/static/media/font.woff2"]);
    expect(isOfflineAsset(routes.offline())).toBe(true);
    expect(isOfflineAsset("/_next/static/chunks/main.js")).toBe(false);
    expect(isOfflineAsset("/w/acme")).toBe(false);
  });

  it("handles page loads only", () => {
    expect(isPageNavigation({ mode: "navigate", method: "GET" })).toBe(true);
    expect(isPageNavigation({ mode: "navigate", method: "POST" })).toBe(false);
    expect(isPageNavigation({ mode: "cors", method: "GET" })).toBe(false);
  });
});
