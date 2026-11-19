import { Check, Scale } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { BOULDER_R, CREW, TOP_X } from "./hill/cast";
import { hillSurface, pathPoint, pathSlope, pathZ } from "./hill/terrain";
import { HORIZON, PERSON_HEIGHT, PERSON_X, PERSON_Z, project, RIDGES, ridgeHalf, ridgeTop, SKY, SKY_STOPS, skyline, starAt, STARS } from "./hill/view";
import { HillScene } from "./hill-scene";

/*
 * The drawing is the three.js scene's first frame, still: the empty hill at dusk and the person at
 * its crest. It is drawn in a 1200×640 box (y from -120) through the scene's own camera
 * (hill/view.ts) from the scene's own hill (hill/terrain.ts), so when the scene has loaded and takes
 * its place nothing moves. Its colours are the same mixes of the same tokens, so it follows every
 * theme. Worked out once, on the server: none of this reaches the browser as script.
 */
const BOX = { width: 1200, height: 640, top: -120 };
const round = (value: number) => Math.round(value * 10) / 10;
/** A point in the scene, in the drawing. */
function at(x: number, y: number, z: number): [number, number] {
  const [u, v] = project(x, y, z);
  return [round(u * BOX.width), round(BOX.top + v * BOX.height)];
}
const points = (list: [number, number][]) => list.map(([x, y]) => `${x},${y}`).join(" ");
const FLOOR = BOX.top + BOX.height;

/** A token, and a mix of two colours as three.js mixes them (in linear light): `amount` of `b` in `a`. */
const token = (name: string) => `var(--color-${name})`;
const mix = (a: string, b: string, amount: number) => `color-mix(in srgb-linear, ${b} ${round(amount * 100)}%, ${a})`;
const shaded = (colour: string, light: number) => mix("black", colour, light);
const HAZE = mix(token("dusk-2"), token("accent"), 0.14);
const GLOW = mix(mix(token("signal"), token("signal-shade"), 0.35), token("accent"), 0.22);
const HILL = token("dusk-hill");

const SKY_TOP = SKY.y + SKY.height / 2;
const skyY = (down: number) => at(SKY.x, SKY_TOP - down * SKY.height, SKY.z)[1];
const skyX = (across: number) => at(SKY.x - SKY.width / 2 + across * SKY.width, SKY.y, SKY.z)[0];
const SKY_BOX = { x: skyX(0), y: skyY(0), width: skyX(1) - skyX(0), height: skyY(1) - skyY(0) };

const STAR_POINTS = Array.from({ length: STARS }, (_, index) => at(...starAt(index))).filter(([x, y]) => x > 0 && x < BOX.width && y > BOX.top && y < FLOOR);

const RIDGE_SHAPES = [...RIDGES].reverse().map((ridge) => {
  const half = ridgeHalf(ridge);
  const crest: [number, number][] = [];
  for (let x = -half; x <= half; x += half / 36) crest.push(at(x, ridgeTop(ridge, x), ridge.z));
  const top = mix(mix(mix(HILL, token("dusk"), 0.5), HAZE, ridge.haze), token("signal"), 0.1 * ridge.haze);
  return { z: ridge.z, shape: points([...crest, [crest.at(-1)![0], FLOOR], [crest[0]![0], FLOOR]]), top, foot: mix(top, HAZE, 0.6), from: Math.min(...crest.map(([, y]) => y)) };
});

const COLUMNS = 150;
const SKYLINE = skyline(COLUMNS).map((down, column): [number, number] => [round((column / COLUMNS) * BOX.width), round(BOX.top + down * BOX.height)]);
const HILL_SHAPE = points([...SKYLINE, [BOX.width, FLOOR], [0, FLOOR]]);
const HILL_TOP = Math.min(...SKYLINE.map(([, y]) => y));

/** The path: its two edges, up the hill and back. */
const PATH_SHAPE = (() => {
  const near: [number, number][] = [];
  const far: [number, number][] = [];
  for (let x = -10; x <= 9; x += 0.15) {
    const z = pathZ(x);
    near.push(at(x, hillSurface(x, z + 0.27), z + 0.27));
    far.push(at(x, hillSurface(x, z - 0.27), z - 0.27));
  }
  return points([...near, ...far.reverse()]);
})();

const PERSON_GROUND = hillSurface(PERSON_X, PERSON_Z);
const PERSON_FEET = at(PERSON_X, PERSON_GROUND, PERSON_Z);
const PERSON_TALL = PERSON_FEET[1] - at(PERSON_X, PERSON_GROUND + PERSON_HEIGHT, PERSON_Z)[1];

/** The call, for where the scene never comes: the boulder at the top, the crew stood back from it. */
const BOULDER = (() => {
  const [x, y, z] = pathPoint(TOP_X);
  const slope = pathSlope(TOP_X);
  const lift = (BOULDER_R * 0.95) / Math.hypot(slope, 1);
  const centre = at(x - slope * lift, y + lift, z);
  return { centre, radius: round(centre[1] - at(x - slope * lift, y + lift + BOULDER_R, z)[1]) };
})();
const TRIMS = ["station-todo", "station-done", "station-inbox"];
const BOTS = CREW.map((look, index) => {
  const x = TOP_X - (look.behind + 0.2) * 0.94;
  const z = pathZ(x) + look.aside;
  const ground = hillSurface(x, z);
  const feet = at(x, ground, z);
  return { feet, tall: round(feet[1] - at(x, ground + 1.44 * look.scale, z)[1]), shell: shaded(mix(token("dusk-ink"), token("accent"), 0.26 + index * 0.13), 0.78), trim: token(TRIMS[index]!), antenna: look.antenna };
});

/** One of the crew, standing: drawn one unit tall from its feet, facing up the hill. */
function Bot({ feet, tall, shell, trim, antenna }: (typeof BOTS)[number]) {
  const ink = shaded(mix(token("dusk"), token("accent"), 0.1), 0.35);
  const dark = shaded(mix(token("dusk"), token("accent"), 0.22), 0.8);
  return (
    <g transform={`translate(${feet[0]} ${feet[1]}) scale(${tall})`} strokeWidth="0.014" style={{ stroke: ink }}>
      <rect x="-0.1" y="-0.33" width="0.07" height="0.3" rx="0.03" style={{ fill: dark }} />
      <rect x="0.03" y="-0.33" width="0.07" height="0.3" rx="0.03" style={{ fill: dark }} />
      <rect x="-0.13" y="-0.08" width="0.19" height="0.08" rx="0.035" style={{ fill: shell }} />
      <rect x="0" y="-0.08" width="0.19" height="0.08" rx="0.035" style={{ fill: shell }} />
      <rect x="-0.24" y="-0.56" width="0.1" height="0.2" rx="0.03" style={{ fill: dark }} />
      <rect x="-0.16" y="-0.64" width="0.32" height="0.32" rx="0.09" style={{ fill: shell }} />
      <rect x="-0.165" y="-0.45" width="0.33" height="0.06" rx="0.025" style={{ fill: trim }} />
      <rect x="-0.02" y="-0.6" width="0.09" height="0.26" rx="0.04" style={{ fill: shell }} />
      <circle cx="0.01" cy="-0.6" r="0.06" style={{ fill: trim }} />
      <line x1="-0.05" y1="-1" x2="-0.07" y2={-1 - antenna * 0.7} strokeWidth="0.02" style={{ stroke: dark }} />
      <circle cx="-0.07" cy={-1 - antenna * 0.7} r="0.035" stroke="none" style={{ fill: token("signal") }} />
      <rect x="-0.17" y="-0.99" width="0.34" height="0.27" rx="0.09" style={{ fill: shell }} />
      <rect x="-0.06" y="-0.93" width="0.24" height="0.14" rx="0.05" style={{ fill: shaded(token("dusk"), 0.4) }} />
      <circle cx="-0.09" cy="-0.86" r="0.055" style={{ fill: trim }} />
      <ellipse cx="0.05" cy="-0.86" rx="0.018" ry="0.03" stroke="none" style={{ fill: token("dusk-ink") }} />
      <ellipse cx="0.12" cy="-0.86" rx="0.018" ry="0.03" stroke="none" style={{ fill: token("dusk-ink") }} />
    </g>
  );
}

/**
 * The person at the crest, as the scene draws them: an anime figure in flat colour with an ink line,
 * one unit tall from the feet, turned down the hill towards the crew.
 */
function PersonDrawn() {
  const ink = shaded(mix(token("dusk"), token("accent"), 0.1), 0.35);
  const skin = shaded(mix(token("dusk-ink"), token("signal-shade"), 0.3), 0.72);
  const sweater = shaded(mix(token("dusk-ink"), token("signal"), 0.1), 0.7);
  const trousers = shaded(mix(token("dusk-2"), token("accent"), 0.45), 0.8);
  const hair = shaded(mix(token("signal-shade"), token("dusk"), 0.3), 0.85);
  return (
    <g transform={`translate(${PERSON_FEET[0]} ${PERSON_FEET[1]}) scale(${round(PERSON_TALL)})`} strokeWidth="0.008" strokeLinejoin="round" style={{ stroke: ink }}>
      <ellipse cx="-0.045" cy="-0.02" rx="0.06" ry="0.024" style={{ fill: shaded(mix(token("dusk"), token("signal-shade"), 0.3), 0.8) }} />
      <ellipse cx="0.02" cy="-0.015" rx="0.06" ry="0.024" style={{ fill: shaded(mix(token("dusk"), token("signal-shade"), 0.3), 0.8) }} />
      <path d="M-0.055 -0.47L-0.075 -0.04H-0.02L0 -0.3L0.01 -0.035H0.06L0.065 -0.47Z" style={{ fill: trousers }} />
      <path d="M0.03 -0.72Q0.09 -0.7 0.09 -0.56L0.085 -0.46Q0.06 -0.44 0.045 -0.46Z" style={{ fill: sweater }} />
      <path d="M-0.07 -0.74Q0 -0.77 0.07 -0.74L0.075 -0.45Q0 -0.42 -0.075 -0.45Z" style={{ fill: sweater }} />
      {/* The arm that holds the phone, low and a little forward. */}
      <g data-idle>
        <path d="M-0.05 -0.73Q-0.1 -0.7 -0.095 -0.6L-0.135 -0.545L-0.11 -0.515L-0.05 -0.59Z" style={{ fill: sweater }} />
        <circle cx="-0.13" cy="-0.525" r="0.02" style={{ fill: skin }} />
        <rect x="-0.158" y="-0.585" width="0.022" height="0.07" rx="0.005" transform="rotate(-25 -0.147 -0.55)" style={{ fill: shaded(token("dusk"), 0.6) }} />
      </g>
      <rect x="-0.018" y="-0.79" width="0.036" height="0.05" stroke="none" style={{ fill: skin }} />
      <path d="M-0.04 -0.775Q0 -0.755 0.04 -0.775V-0.745Q0 -0.725 -0.04 -0.745Z" style={{ fill: sweater }} />
      {/* The head: full cheeks narrowing to a small chin, an ear, and hair in locks. */}
      <path d="M-0.075 -0.9Q-0.08 -0.83 -0.035 -0.79Q-0.01 -0.775 0.02 -0.795Q0.07 -0.83 0.068 -0.9Q0.06 -0.97 -0.005 -0.97Q-0.07 -0.97 -0.075 -0.9Z" style={{ fill: skin }} />
      <ellipse cx="0.035" cy="-0.865" rx="0.012" ry="0.02" style={{ fill: skin }} />
      <path
        d="M-0.085 -0.915L-0.07 -0.875L-0.06 -0.925L-0.045 -0.88L-0.03 -0.93L-0.012 -0.885L0.005 -0.93L0.015 -0.84L0.035 -0.9L0.05 -0.82L0.075 -0.87L0.105 -0.8L0.092 -0.9L0.12 -0.89L0.085 -0.96L0.1 -0.99L0.055 -0.985L0.045 -1.02L0.01 -0.99L-0.015 -1.035L-0.03 -0.99L-0.07 -0.975Z"
        style={{ fill: hair }}
      />
      <ellipse cx="-0.048" cy="-0.868" rx="0.009" ry="0.014" stroke="none" style={{ fill: shaded(token("dusk-ink"), 0.82) }} />
      <ellipse cx="-0.05" cy="-0.867" rx="0.006" ry="0.011" stroke="none" style={{ fill: shaded(mix(token("accent"), token("dusk"), 0.25), 0.85) }} />
      <path d="M-0.06 -0.882Q-0.048 -0.892 -0.036 -0.88" fill="none" strokeWidth="0.006" />
      <path d="M-0.062 -0.823H-0.046" fill="none" strokeWidth="0.005" />
      {/* The answer held up, for where the scene never comes and the drawing shows the call. */}
      <g data-call>
        <path d="M-0.05 -0.735L-0.075 -0.72L-0.19 -0.93L-0.165 -0.955Z" style={{ fill: sweater }} />
        <circle cx="-0.185" cy="-0.955" r="0.02" style={{ fill: skin }} />
        <circle cx="-0.19" cy="-1.01" r="0.11" stroke="none" fill="url(#hill-lamp)" opacity="0.6" />
        <rect x="-0.205" y="-1.05" width="0.03" height="0.075" rx="0.006" style={{ fill: mix(token("signal"), token("dusk-ink"), 0.4) }} />
      </g>
    </g>
  );
}

/**
 * Why the product is called Phean: a crew of AI agents rolls the boulder up the hill, stops at the
 * top for a person's call, and goes back down for the next one. That is the three.js scene
 * (`HillScene`). This figure holds it, the decision card that keeps time with it, and the drawing
 * that stands in for it: the scene's first frame, still, which shows while the scene loads and
 * gives way to it with a cross-fade, and which is all there is where there is no WebGL worth using.
 * There, and with motion off, the drawing shows the call instead (`data-call`): the boulder at the
 * top, the crew stood back, the answer held up. Decorative; the figure's caption says it in words.
 * The loop's beats (the top at 42%, the pick at 54.5%) are the card's keyframes in globals.css,
 * which the scene follows.
 */
export function BoulderHill() {
  return (
    <figure data-hill className="relative">
      <svg aria-hidden viewBox={`0 ${BOX.top} ${BOX.width} ${BOX.height}`} className="hill-canvas block h-auto w-full">
        <defs>
          <linearGradient id="hill-sky" gradientUnits="userSpaceOnUse" x1="0" y1={SKY_BOX.y} x2="0" y2={SKY_BOX.y + SKY_BOX.height}>
            {SKY_STOPS.map(([down, strength], index) => (
              <stop key={down} offset={down} stopOpacity={strength} style={{ stopColor: index === 2 ? mix(HAZE, token("accent"), 0.25) : mix(HAZE, GLOW, [0, 0, 0, 0.5, 1, 1][index]!) }} />
            ))}
          </linearGradient>
          <linearGradient id="hill-sky-sides" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0.08" stopColor="#000" />
            <stop offset="0.36" stopColor="#fff" />
            <stop offset="0.6" stopColor="#fff" />
            <stop offset="0.92" stopColor="#000" />
          </linearGradient>
          <mask id="hill-sky-mask" maskUnits="userSpaceOnUse" x={SKY_BOX.x} y={SKY_BOX.y} width={SKY_BOX.width} height={SKY_BOX.height}>
            <rect x={SKY_BOX.x} y={SKY_BOX.y} width={SKY_BOX.width} height={SKY_BOX.height} fill="url(#hill-sky-sides)" />
          </mask>
          <radialGradient id="hill-horizon">
            <stop offset="0" stopOpacity={HORIZON.strength * 1.5} style={{ stopColor: mix(GLOW, token("dusk-ink"), 0.3) }} />
            <stop offset="0.25" stopOpacity={HORIZON.strength * 0.8} style={{ stopColor: mix(GLOW, token("dusk-ink"), 0.15) }} />
            <stop offset="0.6" stopOpacity={HORIZON.strength * 0.2} style={{ stopColor: GLOW }} />
            <stop offset="1" stopOpacity="0" style={{ stopColor: GLOW }} />
          </radialGradient>
          <linearGradient id="hill-ground" gradientUnits="userSpaceOnUse" x1="0" y1={HILL_TOP} x2="0" y2={FLOOR}>
            <stop offset="0" style={{ stopColor: shaded(mix(HILL, token("dusk-2"), 0.42), 0.3) }} />
            <stop offset="0.4" style={{ stopColor: shaded(mix(HILL, token("dusk"), 0.55), 0.3) }} />
            <stop offset="1" style={{ stopColor: shaded(mix(HILL, token("dusk"), 0.72), 0.24) }} />
          </linearGradient>
          <radialGradient id="hill-warmth" gradientUnits="userSpaceOnUse" cx={PERSON_FEET[0] - 30} cy={PERSON_FEET[1] + 20} r="330">
            <stop offset="0" stopOpacity="0.12" style={{ stopColor: mix(HILL, token("signal"), 0.5) }} />
            <stop offset="1" stopOpacity="0" style={{ stopColor: mix(HILL, token("signal"), 0.5) }} />
          </radialGradient>
          <radialGradient id="hill-lamp">
            <stop offset="0" stopOpacity="0.9" style={{ stopColor: token("signal") }} />
            <stop offset="0.3" stopOpacity="0.4" style={{ stopColor: token("signal") }} />
            <stop offset="1" stopOpacity="0" style={{ stopColor: token("signal") }} />
          </radialGradient>
          <radialGradient id="hill-stone" cx="0.38" cy="0.34" r="0.75">
            <stop offset="0" style={{ stopColor: mix(token("signal"), token("dusk-ink"), 0.25) }} />
            <stop offset="0.55" style={{ stopColor: token("signal") }} />
            <stop offset="1" style={{ stopColor: token("signal-shade") }} />
          </radialGradient>
          <filter id="hill-soft" x="-5%" y="-30%" width="110%" height="160%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        {STAR_POINTS.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="0.9" opacity="0.75" style={{ fill: mix(token("dusk-ink"), token("dusk-muted"), 0.3) }} />
        ))}
        {/* The sky: clear at the top, where the band shows through, warming to the horizon; and the glow on it. */}
        <rect x={SKY_BOX.x} y={SKY_BOX.y} width={SKY_BOX.width} height={SKY_BOX.height} fill="url(#hill-sky)" mask="url(#hill-sky-mask)" />
        <ellipse
          cx={at(HORIZON.x, HORIZON.y, HORIZON.z)[0]}
          cy={at(HORIZON.x, HORIZON.y, HORIZON.z)[1]}
          rx={(at(HORIZON.x + HORIZON.width / 2, HORIZON.y, HORIZON.z)[0] - at(HORIZON.x - HORIZON.width / 2, HORIZON.y, HORIZON.z)[0]) / 2}
          ry={(at(HORIZON.x, HORIZON.y - HORIZON.height / 2, HORIZON.z)[1] - at(HORIZON.x, HORIZON.y + HORIZON.height / 2, HORIZON.z)[1]) / 2}
          fill="url(#hill-horizon)"
        />
        {/* Far hills, each paler than the one before it. */}
        {RIDGE_SHAPES.map((ridge) => (
          <g key={ridge.z}>
            <linearGradient id={`hill-ridge${ridge.z}`} gradientUnits="userSpaceOnUse" x1="0" y1={ridge.from} x2="0" y2={ridge.from + 420}>
              <stop offset="0" style={{ stopColor: ridge.top }} />
              <stop offset="1" style={{ stopColor: ridge.foot }} />
            </linearGradient>
            <polygon points={ridge.shape} fill={`url(#hill-ridge${ridge.z})`} />
          </g>
        ))}
        {/* The hill, the warmth near its crest, and the path worn up it. */}
        <polygon points={HILL_SHAPE} fill="url(#hill-ground)" />
        <polygon points={HILL_SHAPE} fill="url(#hill-warmth)" />
        <polygon points={PATH_SHAPE} filter="url(#hill-soft)" opacity="0.55" style={{ fill: shaded(mix(HILL, token("dusk-ink"), 0.3), 0.55) }} />

        <g data-call>
          <circle cx={BOULDER.centre[0]} cy={BOULDER.centre[1]} r={BOULDER.radius * 2.4} fill="url(#hill-lamp)" opacity="0.55" />
          <ellipse cx={BOULDER.centre[0]} cy={BOULDER.centre[1] + BOULDER.radius * 0.96} rx={BOULDER.radius * 2.6} ry={BOULDER.radius * 0.5} fill="url(#hill-lamp)" opacity="0.5" />
          <circle cx={BOULDER.centre[0]} cy={BOULDER.centre[1]} r={BOULDER.radius} fill="url(#hill-stone)" />
          {[...BOTS].reverse().map((bot) => (
            <Bot key={bot.trim} {...bot} />
          ))}
        </g>
        <PersonDrawn />
      </svg>

      {/* The scene itself; it covers the drawing once it has painted, and keeps time with this clock. */}
      <span aria-hidden data-hill-clock className="pointer-events-none absolute size-px opacity-0" />
      <HillScene />

      {/*
       * The call the crew stopped for, as the Decisions page shows it: in the sky above the person on a wide
       * screen, on the hill's open face below them on a narrower one, and left out where the figure is
       * too small to spare either (the scene still shows the call being made).
       */}
      <div
        aria-hidden
        data-hill-card
        className="absolute right-[3%] bottom-[5%] w-[min(15rem,40%)] rounded-lg bg-panel p-3 text-left shadow-lift max-md:hidden xl:top-[3%] xl:bottom-auto xl:w-[19rem] xl:p-4"
      >
        <p className="flex items-center gap-2">
          <Badge tone="warning">
            <Scale />
            Decision
          </Badge>
          <span className="text-xs text-muted">from 3 agents</span>
        </p>
        <p className="mt-2 text-xs font-semibold text-ink xl:text-sm">The launch is ready. Ship it on Monday?</p>
        <p className="mt-2 flex gap-1.5">
          <span data-hill-pick className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-tint px-3 text-xs font-semibold text-accent-ink ring-2 ring-accent ring-inset">
            <Check className="size-3.5" />
            Ship it
          </span>
          <span className="inline-flex h-7 items-center rounded-full bg-fill px-3 text-xs font-semibold text-ink-2">Hold a week</span>
        </p>
      </div>

      <figcaption className="sr-only">
        A scene of three AI agents rolling a boulder up a hill at dusk: three small robots, the boulder glowing like an ember. At the top they stop and ask the
        person standing there, drawn as an anime character, one question: ship the launch on Monday? The person picks “Ship it” on their phone, smiles and holds
        it up; the boulder is done and vanishes in a column of light, and the robots cheer, turn and walk back down the hill for the next one.
      </figcaption>
    </figure>
  );
}
