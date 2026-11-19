import { BOULDER_R, CREW, TOP_X } from "./hill/cast";
import { hillSurface, pathPoint, pathSlope, pathZ } from "./hill/terrain";
import { HORIZON, PERSON_HEIGHT, PERSON_X, PERSON_Z, project, RIDGES, ridgeHalf, ridgeTop, SKY, SKY_STOPS, skyline, starAt, STARS } from "./hill/view";
import { HillCard } from "./hill-card";
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
 * The person at the crest, as the scene's model stands there (VRoid's AvatarSample_C): dark hair, a
 * dark jacket with a grey front, dark trousers and boots, in flat colour with an ink line. One unit
 * tall from the feet, turned down the hill towards the crew. The model's colours are its own, not the
 * theme's; these are the nearest mixes of the band's tokens, so the drawing still sits in every theme.
 */
function PersonDrawn() {
  const ink = shaded(mix(token("dusk"), token("accent"), 0.1), 0.35);
  const skin = shaded(mix(token("dusk-ink"), token("signal-shade"), 0.22), 0.74);
  const jacket = shaded(mix(token("dusk"), token("dusk-ink"), 0.14), 0.55);
  const front = shaded(mix(token("dusk-ink"), token("dusk"), 0.3), 0.6);
  const trousers = shaded(mix(token("dusk"), token("dusk-ink"), 0.08), 0.5);
  const hair = shaded(mix(token("dusk"), token("signal-shade"), 0.14), 0.42);
  return (
    <g transform={`translate(${PERSON_FEET[0]} ${PERSON_FEET[1]}) scale(${round(PERSON_TALL)})`} strokeWidth="0.008" strokeLinejoin="round" style={{ stroke: ink }}>
      {/* Boots, trousers, and the jacket: dark sleeves and sides, a grey front. */}
      <path d="M-0.075 -0.06H-0.02L-0.012 -0.005H-0.1Z" style={{ fill: jacket }} />
      <path d="M0.005 -0.055H0.06L0.07 0H-0.015Z" style={{ fill: jacket }} />
      <path d="M-0.06 -0.5L-0.078 -0.05H-0.018L0 -0.33L0.008 -0.045H0.064L0.07 -0.5Z" style={{ fill: trousers }} />
      <path d="M0.035 -0.8Q0.095 -0.78 0.097 -0.64L0.092 -0.5Q0.07 -0.475 0.05 -0.5Z" style={{ fill: jacket }} />
      <path d="M-0.075 -0.815Q0 -0.845 0.078 -0.815L0.082 -0.49Q0 -0.46 -0.08 -0.49Z" style={{ fill: jacket }} />
      <path d="M-0.068 -0.8Q-0.03 -0.825 0.012 -0.815L0.016 -0.485Q-0.03 -0.47 -0.072 -0.49Z" stroke="none" style={{ fill: front }} />
      {/* The arm that holds the phone, low and a little forward. */}
      <g data-idle>
        <path d="M-0.055 -0.805Q-0.105 -0.77 -0.1 -0.66L-0.14 -0.6L-0.113 -0.57L-0.053 -0.65Z" style={{ fill: jacket }} />
        <circle cx="-0.135" cy="-0.578" r="0.018" style={{ fill: skin }} />
        <rect x="-0.162" y="-0.635" width="0.022" height="0.07" rx="0.005" transform="rotate(-25 -0.151 -0.6)" style={{ fill: shaded(token("dusk"), 0.6) }} />
      </g>
      <rect x="-0.018" y="-0.86" width="0.036" height="0.05" stroke="none" style={{ fill: skin }} />
      <path d="M-0.045 -0.845Q0 -0.82 0.045 -0.845V-0.805Q0 -0.785 -0.045 -0.805Z" style={{ fill: jacket }} />
      {/* The head: a soft face narrowing to a small chin, under a dark bob with a fringe. */}
      <path d="M-0.07 -0.93Q-0.072 -0.87 -0.03 -0.84Q-0.008 -0.828 0.018 -0.845Q0.062 -0.875 0.062 -0.935Q0.055 -0.995 -0.005 -0.995Q-0.065 -0.995 -0.07 -0.93Z" style={{ fill: skin }} />
      <path
        d="M-0.078 -0.925Q-0.085 -1.005 -0.01 -1.012Q0.075 -1.012 0.078 -0.925Q0.08 -0.87 0.058 -0.85L0.04 -0.9Q0.03 -0.94 0.005 -0.955Q-0.02 -0.925 -0.05 -0.93L-0.058 -0.905L-0.066 -0.93Z"
        style={{ fill: hair }}
      />
      <ellipse cx="-0.046" cy="-0.905" rx="0.007" ry="0.011" stroke="none" style={{ fill: ink }} />
      <path d="M-0.06 -0.864H-0.046" fill="none" strokeWidth="0.005" />
      {/* The answer held up, for where the scene never comes and the drawing shows the call. */}
      <g data-call>
        <path d="M-0.055 -0.805L-0.08 -0.79L-0.19 -0.99L-0.165 -1.015Z" style={{ fill: jacket }} />
        <circle cx="-0.185" cy="-1.012" r="0.018" style={{ fill: skin }} />
        <circle cx="-0.19" cy="-1.07" r="0.11" stroke="none" fill="url(#hill-lamp)" opacity="0.6" />
        <rect x="-0.205" y="-1.105" width="0.03" height="0.075" rx="0.006" style={{ fill: mix(token("signal"), token("dusk-ink"), 0.4) }} />
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
 * top, the crew stood back, the answer held up. Decorative, but for the decision card on the loops
 * where it is the visitor's turn (`HillCard`); the figure's caption says the rest in words.
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

      <HillCard />

      <figcaption className="sr-only">
        A scene of three AI agents rolling a boulder up a hill at dusk: three small robots, the boulder glowing like an ember. At the top they stop and ask the
        person standing there, an anime character in a dark jacket, one question: ship the launch on Monday? The person picks “Ship it” on their phone, smiles
        and holds it up; the boulder is done and vanishes in a column of light, and the robots cheer, turn and walk back down the hill for the next one. Every
        fourth time, the scene waits at the question for you to make the call; hold a week, and the boulder rolls back down the hill with the robots after it.
      </figcaption>
    </figure>
  );
}
