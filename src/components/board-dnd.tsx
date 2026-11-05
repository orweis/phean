"use client";

import { useEffect, useRef, useState, useTransition, type DragEvent, type ReactNode } from "react";

import { updateTaskAction } from "@/app/w/[slug]/actions";
import { IDLE } from "@/lib/action-state";
import { cx } from "@/lib/cx";
import { truncate } from "@/lib/format";
import type { Stage } from "@/lib/workflow";

import { useStatus } from "./ui/status-region";

/** The drag payload's type, so lanes ignore files, links and text dragged in from elsewhere. */
const TASK_MIME = "application/x-phean-task";

/** Grabbing a field, button, link or open panel inside a card must not start a drag. */
const NOT_A_HANDLE = "input, textarea, select, button, a, summary, details[open] > div";

/** How long a card that just landed keeps its ring. */
const LANDED_MS = 1800;

interface Dragged {
  taskId: string;
  /** The stage the card left, so Undo can put it back. */
  from: { key: string; label: string };
  title: string;
}

/**
 * A board card people can pick up and drop on another lane. The grab cursor and its role
 * description say it moves; there is no tooltip to pop up over the card.
 */
export function DraggableTask({ taskId, from, title, children }: Dragged & { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      ref={ref}
      draggable
      aria-roledescription="draggable task"
      className={cx("cursor-grab active:cursor-grabbing", dragging && "opacity-50")}
      onPointerDown={(event) => {
        // Firefox will not select text in a field inside a draggable element, so only arm the drag from the card itself.
        if (ref.current) ref.current.draggable = !(event.target as Element).closest(NOT_A_HANDLE);
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData(TASK_MIME, JSON.stringify({ taskId, from, title } satisfies Dragged));
        event.dataTransfer.setData("text/plain", title);
        event.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => {
        setDragging(false);
        if (ref.current) ref.current.draggable = true;
      }}
    >
      {children}
    </div>
  );
}

function readDragged(event: DragEvent): Dragged | null {
  try {
    const value = JSON.parse(event.dataTransfer.getData(TASK_MIME)) as Partial<Dragged>;
    const from = value.from;
    return typeof value.taskId === "string" && from && typeof from.key === "string" && typeof from.label === "string"
      ? { taskId: value.taskId, from: { key: from.key, label: from.label }, title: typeof value.title === "string" ? value.title : "" }
      : null;
  } catch {
    return null;
  }
}

const carriesTask = (event: DragEvent) => event.dataTransfer.types.includes(TASK_MIME);

/** Posts a move to a stage, which sets the task's status to the stage's kind. */
function moveTo(slug: string, taskId: string, stage: string) {
  const form = new FormData();
  form.set("workspace", slug);
  form.set("taskId", taskId);
  form.set("stage", stage);
  return updateTaskAction(IDLE, form);
}

/**
 * A board lane that takes dropped cards. While a card is over it the lane tints and shows a drop
 * line; once the move lands, the card is scrolled into view with a brief ring, and the status
 * region says where it went, with Undo to put it back.
 */
export function DropLane({ stage, slug, className, children }: { stage: Pick<Stage, "key" | "label">; slug: string; className?: string; children: ReactNode }) {
  const [over, setOver] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const landed = useRef<string | null>(null);
  const lane = useRef<HTMLDivElement>(null);
  const region = useStatus();

  // Once the move has rendered, find the card in its new lane for the eye.
  useEffect(() => {
    if (pending || !landed.current) return;
    const card = lane.current?.querySelector<HTMLElement>(`[data-task="${landed.current}"]`);
    landed.current = null;
    if (!card) return;
    card.dataset.flash = "";
    card.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    const timer = setTimeout(() => delete card.dataset.flash, LANDED_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  const move = ({ taskId, from, title }: Dragged) => {
    if (from.key === stage.key) return;
    setError(null);
    startTransition(async () => {
      const result = await moveTo(slug, taskId, stage.key);
      if (result.status === "error") {
        setError(result.message ?? "Could not move the task.");
        return;
      }
      landed.current = taskId;
      const name = title ? `“${truncate(title, 60)}”` : "the task";
      region?.announce({
        message: `Moved ${name} to ${stage.label}`,
        workspace: slug,
        undo: { action: updateTaskAction, fields: { taskId, stage: from.key }, done: `${name} is back in ${from.label}.` },
      });
    });
  };

  return (
    <div
      ref={lane}
      data-lane={stage.key}
      aria-busy={pending}
      className={cx(
        "relative rounded-md transition-[background-color] duration-(--dur-micro)",
        over && "bg-fill",
        pending && "opacity-70",
        className,
      )}
      onDragEnter={(event) => {
        if (!carriesTask(event)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!carriesTask(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        setOver(false);
        const dragged = readDragged(event);
        if (!dragged) return;
        event.preventDefault();
        move(dragged);
      }}
    >
      {over && <span aria-hidden data-drop-line className="absolute inset-x-1 -top-1 h-0.5 rounded-full bg-accent" />}
      {children}
      <p role="status" className="sr-only">
        {pending ? `Moving the task to ${stage.label}.` : ""}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs font-semibold text-late-ink">
          {error}
        </p>
      )}
    </div>
  );
}
