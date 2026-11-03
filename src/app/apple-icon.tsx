import { ImageResponse } from "next/og";

import { MARK } from "@/components/logo";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The home screen icon: the mark on a dusk tile, in the sRGB values of the dark-appearance tokens. */
const TILE = { top: "#3b296b", bottom: "#211541", hill: "#8d71e6", shade: "#d96533", lit: "#fa934e" };

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", background: `linear-gradient(${TILE.top}, ${TILE.bottom})` }}>
      <svg viewBox="0 0 32 32" width={size.width} height={size.height} aria-hidden>
        <path d={MARK.tileHill} fill={TILE.hill} />
        <circle {...MARK.boulder} fill={TILE.shade} />
        <path d={MARK.lit} fill={TILE.lit} />
      </svg>
    </div>,
    size,
  );
}
