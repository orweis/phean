"use client";

import { useRef, useState, useTransition, type DragEvent, type ReactNode } from "react";

import { completeTaskAction, updateTaskAction } from "@/app/w/[slug]/actions";
import { IDLE } from "@/lib/action-state";
import { cx } from "@/lib/cx";
import { TASK_STATUS_META, type Station, type TaskStatus } from "@/lib/domain";

/** The drag payload's type, so lanes ignore files, links and text dragged in from elsewhere. */
const TASK_MIME = "application/x-phean-task";

/** Grabbing a field, button, link or open panel inside a card must not start a drag. */
const NOT_A_HANDLE = "input, textarea, select, button, a, summary, details[open] > div";

interface Dragged {
  taskId: string;
  status: TaskStatus;
}

/** A board card people can pick up and drop on another lane. */
export function DraggableTask({ taskId, status, title, children }: Dragged & { title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      ref={ref}
      draggable
      aria-roledescription="draggable task"
      title={`Drag "${title}" to another lane to move it`}
      className={cx("cursor-grab active:cursor-grabbing", dragging && "opacity-50")}
      onPointerDown={(event) => {
        // Firefox will not select text in a field inside a draggable element, so only arm the drag from the card itself.
        if (ref.current) ref.current.draggable = !(event.target as Element).closest(NOT_A_HANDLE);
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData(TASK_MIME, JSON.stringify({ taskId, status } satisfies Dragged));
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
    return typeof value.taskId === "string" && typeof value.status === "string" ? (value as Dragged) : null;
  } catch {
    return null;
  }
}

const carriesTask = (event: DragEvent) => event.dataTransfer.types.includes(TASK_MIME);

/**
 * A board lane that takes dropped cards. Dropping on Done completes the task, so it is logged as
 * completion; any other lane sets the status. The page refreshes with the card in its new lane.
 */
export function DropLane({ status, slug, className, children }: { status: Station; slug: string; className?: string; children: ReactNode }) {
  const [over, setOver] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const move = ({ taskId, status: from }: Dragged) => {
    if (from === status) return;
    const form = new FormData();
    form.set("workspace", slug);
    form.set("taskId", taskId);
    if (status !== "done") form.set("status", status);
    setError(null);
    startTransition(async () => {
      const result = await (status === "done" ? completeTaskAction : updateTaskAction)(IDLE, form);
      if (result.status === "error") setError(result.message ?? "Could not move the task.");
    });
  };

  return (
    <div
      data-lane={status}
      aria-busy={pending}
      className={cx(
        "rounded-md transition-[background-color,outline-color] duration-(--dur-micro)",
        over && "bg-accent-tint outline-2 outline-offset-4 outline-accent/50 outline-dashed",
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
      {children}
      <p role="status" className="sr-only">
        {pending ? `Moving the task to ${TASK_STATUS_META[status].label}.` : ""}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs font-semibold text-late-ink">
          {error}
        </p>
      )}
    </div>
  );
}
