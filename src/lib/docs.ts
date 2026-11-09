import { isValidElement, type ReactNode } from "react";

/** A heading's words without its Markdown: code ticks, emphasis, and link targets. */
export function plainHeading(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .trim();
}

/** The anchor of a docs heading, the same from its Markdown (the outline) and its rendered text (the heading). */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
}

/** The text a rendered heading shows, through any code or emphasis inside it. */
export function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}
