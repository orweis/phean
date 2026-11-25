"use client";

import { Send } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { LIMITS } from "@/lib/domain";
import { starterChips, type QuickItem } from "@/lib/quick-decisions";

import { Button, buttonClasses, type ButtonSize, type ButtonVariant } from "../ui/button";
import { Field, Textarea } from "../ui/field";
import { Popover, PopoverCancel, usePopover } from "../ui/popover";

interface ComposerProps {
  item: QuickItem;
  /** Sends the written answer, pinned to the request (`requestId`) like the Decisions page's form. */
  onSend: (answer: string) => void;
  label: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  triggerClassName?: string;
  icon?: ReactNode;
}

/**
 * A written answer, in a sheet over the card (a bottom sheet on a phone): the question stays in
 * view, starter phrases fill the field for a quick edit, and Send answer waits for some words.
 */
export function Composer({ item, onSend, label, variant = "ghost", size, triggerClassName, icon }: ComposerProps) {
  return (
    <Popover
      label={label}
      icon={icon}
      variant={variant}
      size={size}
      align="left"
      title={`Answer ${item.request.agentName}`}
      triggerClassName={triggerClassName}
      // On a phone the sheet covers the status region while it is open, so a notice never hides Send answer.
      className="max-sm:z-[60] sm:w-[26rem]"
    >
      <ComposerForm item={item} onSend={onSend} />
    </Popover>
  );
}

function ComposerForm({ item, onSend }: { item: QuickItem; onSend: (answer: string) => void }) {
  const popover = usePopover();
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const id = `quick-answer-${item.request.id}`;
  const decision = item.request.kind === "decision";
  const starters = starterChips(item.request);

  return (
    <form
      data-composer
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const answer = text.trim();
        if (!answer) return;
        setText("");
        popover?.close();
        onSend(answer);
      }}
    >
      <p className="line-clamp-3 border-l-2 border-wait pl-2.5 text-xs wrap-anywhere text-ink-2">{item.request.question}</p>
      <ul aria-label="Start from" className="flex flex-wrap gap-1.5">
        {starters.map((starter) => (
          <li key={starter} className="max-w-full min-w-0">
            <button
              type="button"
              className={buttonClasses("secondary", "sm", "max-w-full")}
              onClick={() => {
                setText(starter);
                const box = field.current;
                if (!box) return;
                box.focus();
                // The cursor goes to the end, ready for the condition.
                requestAnimationFrame(() => box.setSelectionRange(starter.length, starter.length));
              }}
            >
              <span className="truncate">{starter.trim()}</span>
            </button>
          </li>
        ))}
      </ul>
      <Field label={decision ? "Your decision" : "Your answer"} htmlFor={id} hint={`${item.request.agentName} gets this right away.`}>
        <Textarea ref={field} id={id} name="answer" value={text} maxLength={LIMITS.note} onChange={(event) => setText(event.target.value)} />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={!text.trim()}>
          <Send aria-hidden />
          Send answer
        </Button>
        <PopoverCancel />
      </div>
    </form>
  );
}
