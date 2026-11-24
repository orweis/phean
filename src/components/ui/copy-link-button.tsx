"use client";

import { Check, Link2 } from "lucide-react";
import { useState } from "react";

import { track } from "@/lib/analytics";
import { linkKindOfPath } from "@/lib/links";

import { Button, type ButtonVariant } from "./button";

/**
 * Copies an absolute link to one thing in Phean (a task, goal, document, memory or decision), on
 * the origin the person is using, to paste into a chat or a handoff note. `subject` names it for
 * screen readers ("link to this task"). Each copy sends `copy_link` with the kind of thing the path
 * names (`linkKindOfPath`), never the path.
 */
export function CopyLinkButton({ path, subject, variant = "ghost", compact = false }: { path: string; subject: string; variant?: ButtonVariant; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant={variant}
      aria-label={`${copied ? "Copied" : "Copy"} ${subject}`}
      title={compact ? `Copy ${subject}` : undefined}
      onClick={async () => {
        await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
        setCopied(true);
        track("copy_link", { kind: linkKindOfPath(path) ?? "other" });
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check aria-hidden /> : <Link2 aria-hidden />}
      {!compact && (copied ? "Copied" : "Copy link")}
    </Button>
  );
}
