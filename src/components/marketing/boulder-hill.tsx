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

/*
 * The person at the crest, traced from the scene's own first frame (VRoid's AvatarSample_C as the
 * scene stands and poses it: feet apart, the weight on one leg, the phone low in the right hand,
 * the head turned down the hill). Each shape is a polygon in units of the figure's height, from the
 * point between its feet; it is placed and sized through the scene's camera (PERSON_FEET,
 * PERSON_TALL), so it follows the camera if that moves, and needs tracing again only if the pose does.
 * Matched against the live frame, the drawn figure sat a pixel low at 1440px; the half a percent of its
 * height taken off below is that.
 */
const FIGURE = {
  bootL: "-0.0741,-0.0977 -0.0204,-0.0977 -0.0171,-0.0163 -0.0464,0.0033 -0.1246,0.0000 -0.1344,-0.0195 -0.0953,-0.0489",
  bootR: "0.0480,-0.0847 0.0936,-0.0847 0.0871,0.0081 0.0448,0.0244 0.0106,0.0130 0.0122,-0.0081 0.0383,-0.0407",
  ankleL: "-0.0660,-0.1531 -0.0220,-0.1531 -0.0220,-0.0896 -0.0708,-0.0896",
  ankleR: "0.0513,-0.1368 0.0920,-0.1368 0.0920,-0.0782 0.0513,-0.0782",
  legL: "-0.0497,-0.4723 0.0220,-0.4642 0.0057,-0.3094 0.0024,-0.1498 -0.0790,-0.1498 -0.0871,-0.3094 -0.0790,-0.3909",
  legR: "0.0269,-0.4642 0.1458,-0.4528 0.1197,-0.3094 0.1262,-0.2280 0.1132,-0.1303 0.0383,-0.1384 0.0285,-0.3094",
  torso: "-0.0204,-0.7997 0.0187,-0.8143 0.1246,-0.8143 0.1621,-0.7899 0.1783,-0.7329 0.1832,-0.6352 0.1767,-0.5049 0.1523,-0.4463 0.1002,-0.4511 -0.0497,-0.4642 -0.0529,-0.5375 -0.0432,-0.6189 -0.0301,-0.7003",
  front: "-0.0187,-0.7948 0.0220,-0.7866 0.1083,-0.7883 0.1164,-0.7329 0.1050,-0.6352 0.1018,-0.5212 0.0855,-0.4528 -0.0057,-0.4625 -0.0480,-0.4788 -0.0513,-0.5375 -0.0415,-0.6189 -0.0285,-0.7166",
  stripe: "0.1572,-0.7850 0.1718,-0.7003 0.1767,-0.6026 0.1621,-0.5049 0.1474,-0.4560",
  collar: "0.0090,-0.8322 0.0269,-0.8436 0.0871,-0.8518 0.1213,-0.8306 0.1311,-0.7948 0.0220,-0.7866 0.0024,-0.8046",
  handR: "0.0839,-0.4479 0.1083,-0.4625 0.1213,-0.4300 0.0985,-0.3974 0.0806,-0.4072",
  armL: "-0.0155,-0.8013 -0.0432,-0.7736 -0.0708,-0.7166 -0.0953,-0.6515 -0.1246,-0.5993 -0.1409,-0.5700 -0.1279,-0.5342 -0.0790,-0.5326 -0.0578,-0.5700 -0.0415,-0.6189 -0.0285,-0.6840",
  handL: "-0.1311,-0.5765 -0.0953,-0.5831 -0.0790,-0.5570 -0.0888,-0.5342 -0.1246,-0.5375",
  phone: "-0.1474,-0.5831 -0.0757,-0.5603 -0.0790,-0.5440 -0.1507,-0.5651",
  face: "0.0073,-0.9121 0.0024,-0.8762 0.0138,-0.8502 0.0220,-0.8355 0.0611,-0.8420 0.0855,-0.8616 0.0888,-0.8958 0.0220,-0.9186",
  ear: "0.0888,-0.8958 0.1034,-0.8990 0.1067,-0.8762 0.0936,-0.8632",
  hair: "-0.0057,-0.8958 -0.0008,-0.9430 0.0269,-0.9756 0.0757,-0.9870 0.1197,-0.9739 0.1376,-0.9365 0.1393,-0.8762 0.1295,-0.8502 0.1083,-0.8469 0.1034,-0.8762 0.0871,-0.8958 0.0839,-0.8697 0.0676,-0.8599 0.0562,-0.8876 0.0415,-0.8599 0.0285,-0.8925 0.0122,-0.9088 0.0024,-0.8795",
  eye: "0.0187,-0.8876 0.0301,-0.8909 0.0301,-0.8795 0.0204,-0.8779",
  armUp: "-0.0187,-0.7980 0.0057,-0.7785 -0.0529,-0.9446 -0.0725,-1.0033 -0.1018,-0.9935 -0.0790,-0.8876",
  handUp: "-0.1018,-1.0228 -0.0725,-1.0261 -0.0692,-0.9935 -0.0985,-0.9870",
  phoneUp: "-0.1116,-1.0912 -0.0790,-1.0945 -0.0741,-1.0163 -0.1067,-1.0130",
};

/**
 * The person, drawn: flat colour, as the cel shading leaves the model at this size. The model's
 * colours are its textures' own, not the theme's; these are tones of the band's `dusk-ink`, which is
 * near white in every theme, so the figure is the same greys everywhere, as the model is.
 */
function PersonDrawn() {
  const tone = (light: number) => shaded(token("dusk-ink"), light);
  const skin = shaded(mix(token("dusk-ink"), token("signal-shade"), 0.22), 0.42);
  const hair = shaded(mix(token("dusk-ink"), token("signal-shade"), 0.5), 0.028);
  const fill = (colour: string) => ({ fill: colour });
  return (
    <g transform={`translate(${PERSON_FEET[0]} ${round(PERSON_FEET[1] - 0.005 * PERSON_TALL)}) scale(${round(PERSON_TALL)})`}>
      <polygon points={FIGURE.bootL} style={fill(tone(0.018))} />
      <polygon points={FIGURE.bootR} style={fill(tone(0.018))} />
      <polygon points={FIGURE.ankleL} style={fill(tone(0.008))} />
      <polygon points={FIGURE.ankleR} style={fill(tone(0.008))} />
      <polygon points={FIGURE.legL} style={fill(tone(0.011))} />
      <polygon points={FIGURE.legR} style={fill(tone(0.011))} />
      <polygon points={FIGURE.torso} style={fill(tone(0.016))} />
      <polygon points={FIGURE.front} style={fill(shaded(mix(token("dusk-ink"), token("accent"), 0.12), 0.2))} />
      <polyline points={FIGURE.stripe} fill="none" strokeWidth="0.006" style={{ stroke: tone(0.35) }} />
      <polygon points={FIGURE.handR} style={fill(skin)} />
      {/* The arm that holds the phone, low and a little forward. */}
      <g data-idle>
        <polygon points={FIGURE.armL} style={fill(tone(0.02))} />
        <polygon points={FIGURE.phone} style={fill(tone(0.06))} />
        <polygon points={FIGURE.handL} style={fill(skin)} />
      </g>
      <polygon points={FIGURE.face} style={fill(skin)} />
      <polygon points={FIGURE.ear} style={fill(skin)} />
      <polygon points={FIGURE.collar} style={fill(tone(0.012))} />
      <polygon points={FIGURE.hair} style={fill(hair)} />
      <polygon points={FIGURE.eye} style={fill(tone(0.01))} />
      {/* The answer held up, for where the scene never comes and the drawing shows the call. */}
      <g data-call>
        <polygon points={FIGURE.armUp} style={fill(tone(0.02))} />
        <circle cx={-0.085} cy={-0.99} r="0.11" fill="url(#hill-lamp)" opacity="0.6" />
        <polygon points={FIGURE.phoneUp} style={fill(mix(token("signal"), token("dusk-ink"), 0.4))} />
        <polygon points={FIGURE.handUp} style={fill(skin)} />
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
            <stop offset="0" style={{ stopColor: shaded(mix(HILL, token("dusk-2"), 0.42), 0.24) }} />
            <stop offset="0.4" style={{ stopColor: shaded(mix(HILL, token("dusk"), 0.55), 0.24) }} />
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
        and holds it up; the boulder is done and vanishes in a column of light, and the robots cheer, turn and walk back down the hill for the next one. After
        the first two times, the scene waits at the question for you to make the call; hold a week, and the boulder rolls back down the hill with the robots after it.
      </figcaption>
    </figure>
  );
}
