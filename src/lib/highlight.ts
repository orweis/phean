/**
 * Marks where a search's words occur in a result, the way the full-text search matches them:
 * whole words and word prefixes, ignoring case. Client-safe.
 */

export interface Piece {
  text: string;
  match: boolean;
}

/** The words of a query, longest first so a longer word wins where two overlap. */
export function searchTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words)].sort((a, b) => b.length - a.length);
}

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` split into plain and matching pieces; a word matches where one of the terms starts it. */
export function highlight(text: string, terms: readonly string[]): Piece[] {
  if (terms.length === 0 || !text) return text ? [{ text, match: false }] : [];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${terms.map(escape).join("|")})`, "giu");
  const pieces: Piece[] = [];
  let last = 0;
  for (const found of text.matchAll(pattern)) {
    if (found.index > last) pieces.push({ text: text.slice(last, found.index), match: false });
    pieces.push({ text: found[0], match: true });
    last = found.index + found[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last), match: false });
  return pieces;
}

/**
 * About `length` characters of `text` around its first match, cut at word boundaries with an
 * ellipsis where it was cut, so a long description shows why it matched.
 */
export function excerpt(text: string, terms: readonly string[], length = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= length) return flat;
  const first = highlight(flat, terms).findIndex((piece) => piece.match);
  const at = first === -1 ? 0 : highlight(flat, terms).slice(0, first).reduce((sum, piece) => sum + piece.text.length, 0);
  let start = Math.max(0, Math.min(at - Math.floor(length / 3), flat.length - length));
  if (start > 0) start = flat.indexOf(" ", start) + 1 || start;
  let end = Math.min(flat.length, start + length);
  if (end < flat.length) end = flat.lastIndexOf(" ", end) > start ? flat.lastIndexOf(" ", end) : end;
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}
