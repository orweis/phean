import { ImageResponse } from "next/og";

import { MARK } from "@/components/logo";

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
