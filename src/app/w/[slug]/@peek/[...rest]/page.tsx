/**
 * Navigating anywhere else closes the peek: a slot keeps showing what it last matched, so every
 * other workspace path matches this, which renders nothing.
 */
export default function NoPeek() {
  return null;
}
