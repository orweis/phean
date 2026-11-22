import { MARK } from "@/components/logo";

/** The mark on its dusk tile, in the sRGB values of the dark-appearance tokens: fixed, whatever theme is on. */
export const TILE = { top: "#3b296b", bottom: "#211541", hill: "#8d71e6", shade: "#d96533", lit: "#fa934e" } as const;

/** The full-bleed square tile for `ImageResponse`: the home screen icon and the Claude plugin's icon. */
export function BrandTile({ size }: { size: number }) {
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: `linear-gradient(${TILE.top}, ${TILE.bottom})` }}>
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
        <path d={MARK.tileHill} fill={TILE.hill} />
        <circle {...MARK.boulder} fill={TILE.shade} />
        <path d={MARK.lit} fill={TILE.lit} />
      </svg>
    </div>
  );
}
