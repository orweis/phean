import { ImageResponse } from "next/og";

import { MARK } from "@/components/logo";
import { NOTIFICATION_BADGE_SIZE, type NotificationBadge } from "@/lib/routes";

/** The app icon: the mark on a dusk tile, in the sRGB values of the dark-appearance tokens. */
const TILE = { top: "#3b296b", bottom: "#211541", hill: "#8d71e6", shade: "#d96533", lit: "#fa934e" };

/**
 * The app icon as a square PNG, full bleed. The boulder sits within the central circle a launcher's
 * mask keeps (40% of the width from the centre), so the same tile serves as a maskable icon.
 */
export function appIcon(size: number): ImageResponse {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", background: `linear-gradient(${TILE.top}, ${TILE.bottom})` }}>
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
        <path d={MARK.tileHill} fill={TILE.hill} />
        <circle {...MARK.boulder} fill={TILE.shade} />
        <path d={MARK.lit} fill={TILE.lit} />
      </svg>
    </div>,
    { width: size, height: size },
  );
}

/** A badge's boulder is a little smaller than the mark's, so a clear gap parts it from the slope at 24dp. */
const BADGE_BOULDER = { cx: MARK.boulder.cx, cy: MARK.boulder.cy - 0.4, r: 5.6 };

/**
 * A notification's status-bar badge: the mark as a white silhouette on a transparent ground, since
 * Android keeps only a badge's alpha (an opaque or coloured image shows as a white square). An
 * agent asking shows the boulder on its slope; a request closed elsewhere shows a check where the
 * boulder was, so the status bar says which one it is without opening the shade.
 */
export function notificationBadge(kind: NotificationBadge, size = NOTIFICATION_BADGE_SIZE): ImageResponse {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      {/* A 2-unit inset, as Android's 24dp status-bar icons keep about 2dp clear. */}
      <svg viewBox="-2 -2 36 36" width={size} height={size} aria-hidden>
        <path d={MARK.hill} fill="#ffffff" />
        {kind === "request" ? (
          <circle {...BADGE_BOULDER} fill="#ffffff" />
        ) : (
          <path d="M6.5 16.5L11 21L19.5 10.5" fill="none" stroke="#ffffff" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </div>,
    { width: size, height: size },
  );
}
