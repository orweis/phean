/** The most a favicon badge spells out; beyond it the badge reads "99+", as mail apps do. */
export const FAVICON_BADGE_MAX = 99;

/** What the tab's favicon badge says for a count, or null for no badge. */
export function faviconBadgeText(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null;
  return count > FAVICON_BADGE_MAX ? `${FAVICON_BADGE_MAX}+` : String(Math.floor(count));
}
