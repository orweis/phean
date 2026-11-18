import { encode } from "uqr";

/**
 * A QR code as one SVG path. Dark modules on the dusk band's light ink, with a quiet zone, read the
 * same in either appearance; scanners struggle with codes drawn light on dark.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { data, size } = encode(value, { ecc: "M", border: 0 });
  const quiet = 4;
  const path = data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x + quiet} ${y + quiet}h1v1h-1z`] : []))).join("");
  const extent = size + quiet * 2;
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${extent} ${extent}`} shapeRendering="crispEdges" className="size-44 shrink-0 rounded-md bg-dusk-ink">
      <path d={path} className="fill-dusk" />
    </svg>
  );
}
