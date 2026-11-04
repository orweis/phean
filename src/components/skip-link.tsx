/** The first stop for keyboard users: past the header and the tab rail, straight to the page. */
export function SkipLink() {
  return (
    <a
      href="#content"
      className="glass-float fixed top-3 left-3 z-50 -translate-y-20 rounded-full px-4 py-2 text-sm font-semibold text-ink focus-visible:translate-y-0 motion-safe:transition-transform motion-safe:duration-(--dur-short)"
    >
      Skip to content
    </a>
  );
}
