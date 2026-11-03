"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { cx } from "@/lib/cx";

import { Button, type ButtonVariant } from "./button";

export function CopyButton({ value, label = "Copy", variant = "secondary" }: { value: string; label?: string; variant?: ButtonVariant }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant={variant}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** A value to paste elsewhere (a token, a link, an endpoint), shown in full width with its copy button. */
export function CopyField({ value, surface = "panel" }: { value: string; surface?: "panel" | "sunken" }) {
  return (
    <div className="flex items-center gap-2">
      <code
        className={cx(
          "min-w-0 flex-1 truncate rounded-md border border-rule px-2.5 py-2 font-mono text-xs text-ink",
          surface === "panel" ? "bg-panel" : "bg-sunken",
        )}
      >
        {value}
      </code>
      <CopyButton value={value} />
    </div>
  );
}
