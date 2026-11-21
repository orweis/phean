import { describe, expect, it } from "vitest";

import {
  answerCall,
  answeredNotification,
  answerFailedNotification,
  isOfflineAsset,
  isPageNavigation,
  notificationFor,
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
import { routes } from "@/lib/routes";

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
    expect(parsed({ v: 1, type: "resolved", slug: "acme", requestId: "q_abc123", by: "Dana" })).toEqual({ type: "resolved", slug: "acme", requestId: "q_abc123", by: "Dana" });
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
    expect(title).toBe("Scout in Acme");
    expect(options).toMatchObject({ tag: "q_abc123", body: "Which auditor?", actions: [{ action: "option-0", title: "Okafor" }, { action: "option-1", title: "Lindqvist" }] });
    expect(options.data).toMatchObject({ slug: "acme", requestId: "q_abc123", taskId: "t_def456" });
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

  it("replaces the request's notification when it was answered elsewhere, keeping its question", () => {
    const previous = notificationFor(request()).options.data;
    const shown = notificationFor(parsed({ v: 1, type: "resolved", slug: "acme", requestId: "q_abc123", by: "Dana" }), previous);
    expect(shown).toMatchObject({ title: "Answered by Dana", options: { tag: "q_abc123", body: "Which auditor?", actions: [], silent: true } });
    expect(notificationFor(parsed({ v: 1, type: "resolved", slug: "acme", requestId: "q_abc123" })).title).toBe("Answered elsewhere");
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
  });

  it("says what it sent and to whom, with Undo", () => {
    const sent = answeredNotification(data(), { answer: "Okafor", taskTitle: "Pick the auditor", agentName: "Scout" });
    expect(sent).toMatchObject({ title: "Sent “Okafor” to Scout", options: { tag: "q_abc123", body: "Pick the auditor", actions: [{ action: "undo", title: "Undo" }] } });
    expect(undoCall(sent.options.data)).toEqual({ path: routes.pushUndo("acme"), body: { taskId: "t_def456", requestId: "q_abc123" } });
  });

  it("says when the request was already answered, or the answer did not go", () => {
    expect(answerFailedNotification(data(), 409).title).toBe("Already answered");
    expect(answerFailedNotification(data(), 409, "Dana answered first.").options.body).toBe("Dana answered first.");
    expect(answerFailedNotification(data(), 401).title).toBe("Sign in to answer");
    expect(answerFailedNotification(data(), 500).options.actions).toEqual([]);
  });

  it("shows the request again after Undo, and says when Undo is too late", () => {
    expect(undoneNotification(data()).options.actions).toHaveLength(2);
    expect(undoFailedNotification(data(), 409)).toMatchObject({ title: "Too late to undo", options: { body: "Scout already has the answer." } });
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
