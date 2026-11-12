import { Check, Scale } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cx } from "@/lib/cx";

/*
 * The scene is drawn in a 1200×640 box (y from -120, the sky the call card floats in). The slope runs from (140, 470) to (860, 170); everything that
 * climbs it is drawn in the slope's own frame (x up the slope, negative y above its surface), so the
 * crew moves along x alone and leans into the hill as people pushing a weight do.
 */
const SLOPE = { x: 140, y: 470, angle: -22.62 };
const BOULDER = { x: 700, r: 58 };
/** How far the crew climbs in one loop, in the slope's units; `globals.css` (hill-crew) uses the same. */
const CLIMB = 550;

/** The fleet: three agents in the station hues, nose to tail behind the boulder. */
const CREW = [
  { x: BOULDER.x - 78, fill: "fill-move", delay: "0s" },
  { x: BOULDER.x - 116, fill: "fill-inbox", delay: "-0.2s" },
  { x: BOULDER.x - 154, fill: "fill-arrive", delay: "-0.4s" },
] as const;

/** A fixed sky, so the server and every visit draw the same stars. */
const STARS = [
  [60, 60, 1.6],
  [180, 120, 1.2],
  [260, 40, 1.8],
  [370, 96, 1.1],
  [470, 30, 1.4],
  [540, 150, 1.2],
  [640, 70, 1.7],
  [720, 24, 1.1],
  [1010, 40, 1.5],
  [1110, 96, 1.2],
  [1160, 24, 1.8],
  [90, 210, 1.1],
  [320, 220, 1.3],
  [430, 290, 1.1],
  [120, -80, 1.4],
  [300, -40, 1.1],
  [560, -96, 1.6],
  [820, -60, 1.2],
  [960, -100, 1.1],
  [1180, -50, 1.4],
] as const;

/** One agent, feet on the slope at `x`, facing up it, arms on whatever is ahead of it. */
function Agent({ x, fill, delay }: (typeof CREW)[number]) {
  return (
    <g transform={`translate(${x} 0)`}>
      <g data-bob style={{ animationDelay: delay }}>
        <rect data-leg x="-9" y="-17" width="7" height="17" rx="3.5" className={fill} style={{ animationDelay: delay }} />
        <rect data-leg="back" x="3" y="-17" width="7" height="17" rx="3.5" className={cx(fill, "opacity-70")} style={{ animationDelay: delay }} />
        <rect x="-15" y="-48" width="30" height="33" rx="10" className={fill} />
        <line x1="8" y1="-38" x2="27" y2="-38" strokeWidth="7" strokeLinecap="round" className="stroke-dusk-ink" />
        <rect x="-13" y="-72" width="28" height="22" rx="8" className={fill} />
        <rect x="-3" y="-67" width="16" height="10" rx="5" className="fill-dusk" />
        <circle cx="2" cy="-62" r="1.8" className="fill-dusk-ink" />
        <circle cx="8.5" cy="-62" r="1.8" className="fill-dusk-ink" />
        <line x1="1" y1="-72" x2="1" y2="-82" strokeWidth="2.5" strokeLinecap="round" className="stroke-dusk-ink" />
        <circle data-blink cx="1" cy="-85" r="3.5" className="fill-signal" style={{ animationDelay: delay }} />
      </g>
    </g>
  );
}

/** The boulder in the logo's ember, lit from the upper left; its marks turn as it rolls, the light does not. */
function Boulder({ x, r, rolls = false }: { x: number; r: number; rolls?: boolean }) {
  return (
    <g transform={`translate(${x} ${-r})`}>
      <circle r={r} className="fill-signal-shade" />
      <circle r={r * 0.92} cx={-r * 0.1} cy={-r * 0.1} className="fill-signal" />
      <g data-roll={rolls ? "" : undefined}>
        <circle r={r} fill="transparent" />
        <circle cx={r * 0.35} cy={-r * 0.3} r={r * 0.11} className="fill-signal-shade" opacity="0.55" />
        <circle cx={-r * 0.42} cy={r * 0.28} r={r * 0.15} className="fill-signal-shade" opacity="0.45" />
        <circle cx={r * 0.18} cy={r * 0.5} r={r * 0.07} className="fill-signal-shade" opacity="0.6" />
        <circle cx={-r * 0.3} cy={-r * 0.48} r={r * 0.06} className="fill-signal-shade" opacity="0.5" />
      </g>
    </g>
  );
}

/**
 * Why the product is called Phean, drawn: a crew of AI agents rolls the boulder up the hill on a
 * loop, stops at the top for a person's call, and starts on the next one. With motion off it shows
 * the moment at the top, the call made. Decorative; the figure's caption says it in words.
 */
export function BoulderHill() {
  return (
    <figure data-hill className="relative">
      <svg aria-hidden viewBox="0 -120 1200 640" className="block h-auto w-full overflow-visible">
        <defs>
          <linearGradient id="hill-face" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" className="[stop-color:var(--color-dusk-hill)]" stopOpacity="0" />
            <stop offset="0.4" className="[stop-color:var(--color-dusk-hill)]" stopOpacity="0.7" />
            <stop offset="1" className="[stop-color:var(--color-dusk-hill)]" />
          </linearGradient>
          <radialGradient id="hill-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" className="[stop-color:var(--color-signal)]" stopOpacity="0.45" />
            <stop offset="1" className="[stop-color:var(--color-signal)]" stopOpacity="0" />
          </radialGradient>
        </defs>

        {STARS.map(([cx, cy, r], index) => (
          <circle key={`${cx}-${cy}`} data-star cx={cx} cy={cy} r={r} className="fill-dusk-ink" style={{ animationDelay: `${-index * 0.7}s` }} />
        ))}

        {/* The summit, and the warm light of what waits at the top. */}
        <circle cx="900" cy="150" r="190" fill="url(#hill-glow)" />
        <path d="M0 520V482C60 480 100 476 140 470L850 174Q900 151 960 150H1200V520Z" fill="url(#hill-face)" />
        <path d="M0 482C60 480 100 476 140 470L850 174Q900 151 960 150H1200" fill="none" strokeWidth="2" className="stroke-dusk-ink" opacity="0.35" />

        {/* You, at the top with your phone, where the calls are made. */}
        <g transform="translate(1010 150)">
          <path d="M-15 0L-13 -38Q0 -50 13 -38L15 0Z" className="fill-dusk-ink" />
          <circle cy="-60" r="12" className="fill-dusk-ink" />
          <path d="M-9 -36Q-20 -40 -22 -52" fill="none" strokeWidth="6" strokeLinecap="round" className="stroke-dusk-ink" />
          <rect x="-29" y="-66" width="11" height="17" rx="3" className="fill-dusk" />
          <rect data-blink x="-27" y="-64" width="7" height="12" rx="1.5" className="fill-signal" />
        </g>

        <g transform={`translate(${SLOPE.x} ${SLOPE.y}) rotate(${SLOPE.angle})`}>
          {/* The next boulder, already waiting at the foot of the hill. */}
          <g data-next>
            <Boulder x={BOULDER.x - CLIMB} r={BOULDER.r} />
          </g>
          <g data-crew>
            {CREW.map((agent) => (
              <Agent key={agent.fill} {...agent} />
            ))}
            <Boulder x={BOULDER.x} r={BOULDER.r} rolls />
            <g data-done transform={`translate(${BOULDER.x} ${-BOULDER.r})`}>
              <circle r={BOULDER.r + 8} fill="none" strokeWidth="5" className="stroke-arrive" />
            </g>
          </g>
        </g>
      </svg>

      {/* The call the crew stopped for, as the Decisions page shows it. */}
      <div aria-hidden data-hill-card className="absolute top-[3%] right-[3%] w-[min(19rem,44%)] rounded-lg bg-panel p-3 text-left shadow-lift max-sm:hidden sm:p-4">
        <p className="flex items-center gap-2">
          <Badge tone="warning">
            <Scale />
            Decision
          </Badge>
          <span className="text-xs text-muted">from 3 agents</span>
        </p>
        <p className="mt-2 text-sm font-semibold text-ink">The launch is ready. Ship it on Monday?</p>
        <p className="mt-2 flex gap-1.5">
          <span data-hill-pick className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-tint px-3 text-xs font-semibold text-accent-ink ring-2 ring-accent ring-inset">
            <Check className="size-3.5" />
            Ship it
          </span>
          <span className="inline-flex h-7 items-center rounded-full bg-fill px-3 text-xs font-semibold text-ink-2">Hold a week</span>
        </p>
      </div>

      <figcaption className="sr-only">
        A drawing of three AI agents rolling a boulder up a hill at dusk. At the top they stop and ask the person standing there one question: ship the launch on
        Monday? The person picks “Ship it”, the boulder is done, and the next boulder is already waiting at the foot of the hill.
      </figcaption>
    </figure>
  );
}
