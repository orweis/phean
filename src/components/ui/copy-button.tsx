"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

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
