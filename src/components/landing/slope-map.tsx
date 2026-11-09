import type { CSSProperties } from "react";

import { MARK } from "@/components/logo";
import { cx } from "@/lib/cx";

import { SLOPE_ROUTE, SLOPE_STATIONS, SLOPE_SUMMIT } from "./slope-route";

/** The stations the route climbs through, in the board's own hues: what arrives, what is planned, what moves, what waits on you, what is done. */
const STATIONS = [
  { key: "inbox", label: "Captured", dot: "fill-station-inbox", side: "right" },
  { key: "todo", label: "Triaged", dot: "fill-station-todo", side: "right" },
  { key: "progress", label: "Claimed", dot: "fill-station-progress", side: "left" },
  { key: "waiting", label: "Waiting on you", dot: "fill-signal", side: "right" },
  { key: "done", label: "Done", dot: "fill-station-done", side: "left" },
] as const;

/** How much larger than the logo the boulder is drawn on the map. */
const BOULDER_SCALE = 3.1;

/**
 * The hill at dusk as a survey map: contour lines (a generated mask, see `scripts/art/slope.py`,
 * painted in the hill's violet so both appearances keep their tokens), the route the agents climb
 * through the board's stations, and the boulder on it, which rolls up as the page scrolls where the
 * browser supports scroll-driven animation and motion is welcome. The map and its overlay share one
 * crop (cover, anchored right), so the route stays on the ground it was drawn on at every width.
 */
export function SlopeMap({ className, labels = true, boulder = true }: { className?: string; labels?: boolean; boulder?: boolean }) {
  const { cx: bx, cy: by, r } = MARK.boulder;
  return (
    <div aria-hidden className={cx("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className="slope-contours absolute inset-0" />
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMaxYMid slice" className="absolute inset-0 size-full max-md:hidden">
        <path d={SLOPE_ROUTE} fill="none" className="stroke-dusk-ink/80" strokeWidth={3} strokeDasharray="0.1 11" strokeLinecap="round" />
        {STATIONS.map(({ key, label, dot, side }) => {
          const [x, y] = SLOPE_STATIONS[key];
          return (
            <g key={key}>
              <circle cx={x} cy={y} r={10} className={cx(dot, "stroke-dusk")} strokeWidth={4} />
              {labels && (
                <text
                  x={side === "right" ? x + 22 : x - 22}
                  y={y + 6}
                  textAnchor={side === "right" ? "start" : "end"}
                  className="slope-label fill-dusk-ink stroke-dusk max-md:hidden"
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
        <g transform={`translate(${SLOPE_SUMMIT[0]} ${SLOPE_SUMMIT[1]})`}>
          <path d="M0 0V-58" className="stroke-dusk-ink" strokeWidth={3} strokeLinecap="round" />
          <path d="M1.5 -58L40 -47L1.5 -36Z" className="fill-station-done" />
          <circle r={7} className="fill-dusk-ink" />
          {labels && (
            <text x={-16} y={-38} textAnchor="end" className="slope-label fill-dusk-ink stroke-dusk max-md:hidden">
              Goal achieved
            </text>
          )}
        </g>
        {boulder && (
          <g className="slope-boulder" style={{ offsetPath: `path("${SLOPE_ROUTE}")` } as CSSProperties}>
            <g transform={`translate(${-bx * BOULDER_SCALE} ${-(by + r) * BOULDER_SCALE + 2}) scale(${BOULDER_SCALE})`}>
              <circle {...MARK.boulder} className="fill-signal-shade" />
              <path d={MARK.lit} className="fill-signal" />
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}
