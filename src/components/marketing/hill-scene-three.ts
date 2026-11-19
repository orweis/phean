import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";

import { makeBot, makeBotKit, PALM, REACH, type BotLook, type BotMaterials } from "./hill/bot";
import { band, clamp01, fbm } from "./hill/noise";
import { makePerson } from "./hill/person";
import { Parts } from "./hill/rig";
import { FACE, hillSurface, pathLength, pathPoint, pathSlope, pathTurn, pathZ } from "./hill/terrain";
import { beamMap, boulderMaps, glowMap, grainMap, GRASS_SHADE, GROUND, groundMap, knitMap, panelMap, ringMap, shadowMap, stoneAt } from "./hill/textures";

/**
 * The name, in clay: the hero illustration, moving. Three robot agents push the ember boulder in
 * from below the frame and up a long violet hill at dusk, along the path worn into it; the boulder
 * slips, and they catch it. At the crest a person reads the one question the crew stopped for, taps
 * the answer and holds it up: the boulder is done, and leaves in a column of light. The crew cheers,
 * turns, and walks back down the hill and out of the frame for the next one, so the loop ends where
 * it began, on an empty hill. Every colour is the theme's.
 *
 * One loop is `progress` 0..1, the same 18 seconds as `--hill` in globals.css, whose keyframes show
 * the decision card on the same beats (`BEATS` below).
 */

/** The palette, as CSS colours read from the figure's tokens. */
export interface HillPalette {
  dusk: string;
  dusk2: string;
  hill: string;
  ink: string;
  muted: string;
  signal: string;
  signalShade: string;
  accent: string;
  /** The crew's trim, one station hue each. */
  trim1: string;
  trim2: string;
  trim3: string;
}

export interface HillScene {
  setPalette(palette: HillPalette): void;
  /** Draws the loop at `progress` (0..1). */
  render(progress: number): void;
  resize(width: number, height: number): void;
  /** 1 is the full picture; less draws fewer pixels and a coarser shadow, for a device that cannot keep up. */
  setQuality(scale: number): void;
  dispose(): void;
}

/* ---------------------------------------------------------------------------------------------- */

const BOULDER_R = 1.02;
/** Where along the path the boulder starts (out of the frame, below its left edge) and stops, as x; the person stands past the top. */
const START_X = -8.5;
const TOP_X = 2.55;
const PERSON_X = 5.05;
/** The loop's beats, as fractions of it. globals.css keys the decision card to the same ones. */
const BEATS = {
  /** The boulder reaches the top, and the card shows. */
  top: 0.42,
  /** The person taps the answer. */
  tap: 0.545,
  /** The boulder gathers light, */
  charge: 0.552,
  /** goes in a flash, */
  flash: 0.585,
  /** and its light has died away. */
  dark: 0.65,
  /** The crew turns round, */
  turn: 0.685,
  /** and sets off down the hill. */
  descend: 0.7,
};
/** How far down the path the crew walks before the loop ends: enough to take the last of them out of the frame. */
const DESCENT = 9.7;
/** The idle motion (breathing, blinking, the antennas' sway) runs on a clock of this many beats a loop, so it comes round with it. */
const IDLE_BEATS = 13;
/** The loop, in seconds: `--hill` in globals.css and LOOP_MS in hill-scene.tsx. */
const LOOP_SECONDS = 18;
/** The crew, nose to tail as the hero draws them: roughly how far behind the boulder's centre each one's feet are (the push settles the rest). */
const CREW: (BotLook & { behind: number; aside: number; turn: number })[] = [
  { scale: 0.96, behind: 1.62, aside: 0.12, turn: 0.75, antenna: 0.2, antennaAt: 0.06, antennaLean: -0.12 },
  { scale: 0.87, behind: 2.4, aside: 0.26, turn: 0.95, antenna: 0.13, antennaAt: -0.08, antennaLean: -0.3 },
  { scale: 0.79, behind: 3.1, aside: 0.12, turn: 0.6, antenna: 0.27, antennaAt: 0, antennaLean: 0.05 },
];

/** The climb, 0 at the foot to 1 at the top, with the slip Sisyphus knows: it rolls back a little and is caught. */
function climb(p: number): number {
  const up = p / BEATS.top;
  // Already at a walk when the loop begins (it is out of sight then), easing to a stop at the top.
  const pace = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * (0.2 + 0.8 * t));
  const eased = up >= 1 ? 1 : (pace(Math.max(0, up)) - pace(0)) / (1 - pace(0));
  const slip = Math.sin(Math.PI * clamp01((up - 0.56) / 0.13));
  return eased - 0.03 * slip * (up < 1 ? 1 : 0);
}

/** The walk back down, 0 to 1: a step to get going, then steady. */
function descend(p: number): number {
  const t = clamp01((p - BEATS.descend) / (1 - BEATS.descend));
  const ease = 0.12;
  return (t < ease ? (t * t) / (2 * ease) : t - ease / 2) / (1 - ease / 2);
}

/** A stone for the crew to push: a sphere dented into plates, split where the cracks of its texture run. */
function boulderGeometry(): SphereGeometry {
  const geometry = new SphereGeometry(BOULDER_R, 96, 64);
  const position = geometry.getAttribute("position");
  const point = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i).normalize();
    const { dent } = stoneAt(point.x, point.y, point.z, false);
    point.multiplyScalar(BOULDER_R * (1 + dent));
    position.setXYZ(i, point.x, point.y, point.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** A CSS colour (oklch, hex, anything the browser reads) as sRGB, by letting a canvas paint it. */
function cssColor(value: string, probe: CanvasRenderingContext2D): Color {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = value || "#000";
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return new Color().setRGB(r! / 255, g! / 255, b! / 255, SRGBColorSpace);
}

function rgba(color: Color, alpha: number): string {
  const hex = color.getHex(SRGBColorSpace);
  return `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${alpha})`;
}

/* ---------------------------------------------------------------------------------------------- */

/** Lets the page breathe between the heavier steps of painting the textures, so loading the scene never holds a frame for long. */
function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function createHillScene(canvas: HTMLCanvasElement, palette: HillPalette): Promise<HillScene> {
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // Painted first, a step at a time: the stone, the ground, then the small maps.
  const stone = boulderMaps();
  keep(stone.map);
  keep(stone.emissiveMap);
  keep(stone.detail);
  await breathe();
  const ground = keep(groundMap());
  await breathe();
  const stoneGeometry = keep(boulderGeometry());
  const grain = keep(grainMap());
  const glow = keep(glowMap());
  const panels = keep(panelMap());
  const knit = keep(knitMap());
  await breathe();

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  scene.fog = new Fog(0x000000, 16, 46);

  const camera = new PerspectiveCamera(24, 15 / 8, 0.5, 90);
  const lookAt = new Vector3(-0.1, 3.15, 0);
  const cameraHome = new Vector3();

  const probeCanvas = document.createElement("canvas");
  probeCanvas.width = probeCanvas.height = 1;
  const probe = probeCanvas.getContext("2d", { willReadFrequently: true })!;

  /* Lights: the sky's cool fill from the upper left (the one that casts shadows), the last warm light
     low behind the crest, and the boulder itself, which lights whatever is near it. */
  const hemisphere = new HemisphereLight(0xffffff, 0x000000, 0.7);
  scene.add(hemisphere);
  const sky = new DirectionalLight(0xffffff, 1.25);
  sky.position.set(-5, 11, 8);
  sky.target.position.set(0, 1.5, 0);
  sky.castShadow = true;
  sky.shadow.mapSize.set(1024, 1024);
  sky.shadow.camera.left = -9;
  sky.shadow.camera.right = 9;
  sky.shadow.camera.top = 6;
  sky.shadow.camera.bottom = -5;
  sky.shadow.camera.near = 1;
  sky.shadow.camera.far = 32;
  sky.shadow.radius = 5;
  sky.shadow.bias = -0.0006;
  sky.shadow.normalBias = 0.03;
  scene.add(sky, sky.target);
  const rim = new DirectionalLight(0xffffff, 1.6);
  rim.position.set(9, 4, -7);
  scene.add(rim);
  const ember = new PointLight(0xffffff, 10, 9, 1.4);
  scene.add(ember);

  /* The hill, textured from above: chalky grass and the worn path, with a finer grain in its bump. */
  const hillGeometry = keep(new PlaneGeometry(GROUND.width, GROUND.depth, 160, 84));
  hillGeometry.rotateX(-Math.PI / 2);
  hillGeometry.translate(GROUND.x + GROUND.width / 2, 0, GROUND.z + GROUND.depth / 2);
  const hillPositions = hillGeometry.getAttribute("position");
  const hillUv = hillGeometry.getAttribute("uv");
  const hillGrainUv = new Float32Array(hillPositions.count * 2);
  for (let i = 0; i < hillPositions.count; i += 1) {
    const x = hillPositions.getX(i);
    const z = hillPositions.getZ(i);
    // A little roll in the ground away from the path, so the hill is not a ruled surface.
    const roll = 0.16 * (fbm(x * 0.35, z * 0.35, 5, 2) - 0.5) * clamp01(Math.abs(z - pathZ(x)) - 0.8);
    hillPositions.setY(i, hillSurface(x, z) + roll);
    hillUv.setXY(i, (x - GROUND.x) / GROUND.width, (z - GROUND.z) / GROUND.depth);
    hillGrainUv[i * 2] = x * 0.6;
    hillGrainUv[i * 2 + 1] = z * 0.6;
  }
  hillGeometry.computeVertexNormals();
  hillGeometry.setAttribute("uv1", new Float32BufferAttribute(hillGrainUv, 2));
  hillGeometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(hillPositions.count * 3), 3));
  const hillGrain = keep(grain.clone());
  hillGrain.channel = 1;
  const hillMaterial = keep(new MeshLambertMaterial({ vertexColors: true, map: ground, bumpMap: hillGrain, bumpScale: 1.4 }));
  const hill = new Mesh(hillGeometry, hillMaterial);
  hill.receiveShadow = true;
  scene.add(hill);

  /* Stones and tufts of grass beside the path, as the illustrations scatter them. */
  const scatter = new Parts<"rock" | "grass">();
  const ROCKS: [number, number, number][] = [
    [-3.1, 3.4, 0.2],
    [-2.75, 3.65, 0.11],
    [1.9, 4.6, 0.24],
    [4.4, 2.5, 0.15],
    [6.9, 1.7, 0.2],
    [-0.9, 5.2, 0.22],
    [-6.4, 2.1, 0.16],
  ];
  ROCKS.forEach(([x, z, size], index) => {
    const rock = new SphereGeometry(1, 14, 10);
    const at = rock.getAttribute("position");
    const point = new Vector3();
    for (let i = 0; i < at.count; i += 1) {
      point.fromBufferAttribute(at, i);
      point.multiplyScalar(0.8 + 0.4 * fbm(point.x * 1.3 + index * 7, point.y * 1.3, point.z * 1.3, 2));
      at.setXYZ(i, point.x, point.y, point.z);
    }
    rock.computeVertexNormals();
    scatter.add("rock", rock, [x, hillSurface(x, z) + size * 0.22, z], [index, index * 2.1, 0], [size * 1.25, size * 0.7, size]);
  });
  const TUFTS: [number, number][] = [
    [-4.4, 2.4],
    [-1.9, 3.9],
    [0.6, 2.7],
    [2.9, 3.3],
    [5.1, 1.9],
    [-5.6, 4.3],
    [1.1, 5.6],
    [-0.6, 1.5],
    [3.9, 1.3],
    [-3.4, 1.4],
    [6.2, 3.4],
    [-2.2, -1.6],
  ];
  TUFTS.forEach(([x, z], index) => {
    for (let blade = 0; blade < 6; blade += 1) {
      const lean = (blade - 2.5) * 0.19;
      const height = 0.16 + 0.13 * fbm(index * 3.7, blade * 1.9, 2, 1);
      const cone = new ConeGeometry(0.018, height, 4, 1);
      cone.translate(0, height / 2, 0);
      const bx = x + lean * 0.3;
      const bz = z + 0.05 * Math.sin(blade * 2.4 + index);
      scatter.add("grass", cone, [bx, hillSurface(bx, bz) - 0.02, bz], [0.25 * Math.sin(blade * 1.7 + index), 0, -lean * 1.5]);
    }
  });
  const scattered = scatter.build();
  const rockMaterial = keep(new MeshLambertMaterial({ bumpMap: grain, bumpScale: 2 }));
  const grassMaterial = keep(new MeshLambertMaterial());
  for (const [slot, geometry] of scattered) {
    const mesh = new Mesh(keep(geometry), slot === "rock" ? rockMaterial : grassMaterial);
    mesh.castShadow = slot === "rock";
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  /* Far hills: ridges one behind another, each paler than the last, as the hero's horizon. */
  const RIDGES = [
    { z: -9, base: -1.3, height: 1.3, phase: 0.4, haze: 0.22 },
    { z: -15, base: -2.5, height: 1.6, phase: 2.1, haze: 0.42 },
    { z: -22, base: -3.9, height: 2.0, phase: 4.4, haze: 0.6 },
    { z: -30, base: -5.4, height: 2.4, phase: 6.0, haze: 0.76 },
  ];
  const ridgeMaterial = keep(new MeshBasicMaterial({ vertexColors: true, fog: false }));
  const ridges = RIDGES.map((ridge) => {
    const columns = 72;
    const positions: number[] = [];
    const indices: number[] = [];
    const half = 30 - ridge.z * 0.9;
    for (let i = 0; i <= columns; i += 1) {
      const x = -half + (2 * half * i) / columns;
      const roll = 0.55 + 0.3 * Math.sin(x * 0.19 + ridge.phase) + 0.15 * Math.sin(x * 0.43 + ridge.phase * 2.3) + 0.08 * Math.sin(x * 0.9 + ridge.phase * 0.7);
      positions.push(x, ridge.base + ridge.height * (roll - 0.55), ridge.z, x, ridge.base - 16, ridge.z);
      if (i < columns) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
    }
    const geometry = keep(new BufferGeometry());
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(positions.length), 3));
    geometry.setIndex(indices);
    scene.add(new Mesh(geometry, ridgeMaterial));
    return { ...ridge, geometry };
  });

  /* The sky behind them: the band's own dusk above (the canvas is clear there), warming to the horizon. */
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 256;
  skyCanvas.height = 256;
  const skyContext = skyCanvas.getContext("2d")!;
  const skyTexture = keep(new CanvasTexture(skyCanvas));
  skyTexture.colorSpace = SRGBColorSpace;
  const skyMaterial = keep(new MeshBasicMaterial({ map: skyTexture, transparent: true, depthWrite: false, fog: false }));
  const skyPlane = new Mesh(keep(new PlaneGeometry(64, 32)), skyMaterial);
  skyPlane.position.set(-2, -4, -40);
  skyPlane.renderOrder = -2;
  scene.add(skyPlane);

  /* A few stars, high in the band. */
  const starPositions: number[] = [];
  for (let i = 0; i < 80; i += 1) {
    const a = Math.sin(i * 12.9898) * 43758.5453;
    const b = Math.sin(i * 78.233) * 12345.678;
    starPositions.push((a - Math.floor(a) - 0.5) * 60, -3 + (b - Math.floor(b)) * 9, -38);
  }
  const starGeometry = keep(new BufferGeometry());
  starGeometry.setAttribute("position", new Float32BufferAttribute(starPositions, 3));
  const starMaterial = keep(new PointsMaterial({ size: 0.16, transparent: true, opacity: 0.75, fog: false, depthWrite: false }));
  scene.add(new Points(starGeometry, starMaterial));

  /* The boulder. It is the scene's lamp, so it casts no shadow of its own. */
  const boulderMaterial = keep(
    new MeshStandardMaterial({
      map: stone.map,
      emissiveMap: stone.emissiveMap,
      bumpMap: stone.detail,
      bumpScale: 3.5,
      roughnessMap: stone.detail,
      roughness: 1,
      metalness: 0,
      transparent: true,
    }),
  );
  const boulder = new Mesh(stoneGeometry, boulderMaterial);
  // It rolls inside a holder, which is what moves and what stretches when it goes: straight up, however the stone lies.
  const holder = new Group();
  holder.add(boulder);
  scene.add(holder);

  const additive = { map: glow, blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false } as const;
  const haloMaterial = keep(new SpriteMaterial(additive));
  const halo = new Sprite(haloMaterial);
  scene.add(halo);
  // The pool of light the boulder throws on the ground, and the dark where it touches.
  const decal = keep(new PlaneGeometry(1, 1));
  decal.rotateX(-Math.PI / 2);
  const poolMaterial = keep(new MeshBasicMaterial({ ...additive, polygonOffset: true, polygonOffsetFactor: -4 }));
  const pool = new Mesh(decal, poolMaterial);
  pool.renderOrder = 1;
  scene.add(pool);
  const contactMaterial = keep(new MeshBasicMaterial({ map: keep(shadowMap()), transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -6 }));
  const contact = new Mesh(decal, contactMaterial);
  contact.renderOrder = 2;
  scene.add(contact);
  /* How the boulder leaves: a column of light, a flash, a ripple over the ground, and embers rising. */
  const beamMaterial = keep(new SpriteMaterial({ ...additive, map: keep(beamMap()) }));
  const beam = new Sprite(beamMaterial);
  // It stands on its foot and always faces us.
  beam.center.set(0.5, 0);
  beam.renderOrder = 3;
  scene.add(beam);
  const flashMaterial = keep(new SpriteMaterial(additive));
  const flash = new Sprite(flashMaterial);
  flash.renderOrder = 4;
  scene.add(flash);
  const rippleMaterial = keep(new MeshBasicMaterial({ ...additive, map: keep(ringMap()), polygonOffset: true, polygonOffsetFactor: -5 }));
  const ripple = new Mesh(decal, rippleMaterial);
  ripple.renderOrder = 2;
  scene.add(ripple);
  const SPARKS = 72;
  const sparkPaths = Array.from({ length: SPARKS }, (_, index) => {
    const around = index * 2.399963;
    const rise = 0.15 + 0.85 * fbm(index * 0.37, 3, 1, 1);
    const out = Math.sqrt(1 - rise * rise * 0.8);
    const speed = 1.2 + 2.6 * fbm(index * 0.61, 9, 4, 1);
    return [Math.cos(around) * out * speed, rise * speed, Math.sin(around) * out * speed, 0.6 + 0.4 * fbm(index * 0.83, 2, 6, 1)] as const;
  });
  const sparkGeometry = keep(new BufferGeometry());
  const sparkPositions = new Float32BufferAttribute(new Float32Array(SPARKS * 3), 3);
  sparkGeometry.setAttribute("position", sparkPositions);
  const sparkMaterial = keep(new PointsMaterial({ ...additive, size: 0.5, sizeAttenuation: true }));
  const sparks = new Points(sparkGeometry, sparkMaterial);
  sparks.frustumCulled = false;
  sparks.renderOrder = 4;
  scene.add(sparks);

  const horizonMaterial = keep(new SpriteMaterial({ ...additive, opacity: 0.5 }));
  const horizon = new Sprite(horizonMaterial);
  horizon.position.set(-12, -8, -36);
  horizon.scale.set(52, 13, 1);
  horizon.renderOrder = -1;
  scene.add(horizon);

  /* The crew: one kit of parts, three bots, each with its own shell tint and trim. */
  const kit = keep(makeBotKit());
  const dark = keep(new MeshStandardMaterial({ roughness: 0.55, metalness: 0.25 }));
  const visor = keep(new MeshStandardMaterial({ roughness: 0.12, metalness: 0.6 }));
  const eye = keep(new MeshStandardMaterial({ roughness: 0.4 }));
  const tip = keep(new MeshStandardMaterial({ roughness: 0.4 }));
  const shells: MeshStandardMaterial[] = [];
  const trims: MeshStandardMaterial[] = [];
  const crew = CREW.map((look) => {
    const shell = keep(new MeshStandardMaterial({ roughness: 0.72, metalness: 0.05, map: panels, bumpMap: panels, bumpScale: 2.5 }));
    const trim = keep(new MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 }));
    shells.push(shell);
    trims.push(trim);
    const materials: BotMaterials = { shell, dark, trim, visor, eye, tip };
    const bot = keep(makeBot(kit, materials, look));
    scene.add(bot.root);
    return { ...look, bot, hands: [new Vector3(), new Vector3()] as const, fit: 0 };
  });
  const tipGlows = crew.map(() => {
    const sprite = new Sprite(keep(new SpriteMaterial(additive)));
    scene.add(sprite);
    return sprite;
  });

  /* You, at the top. */
  knit.repeat.set(3, 3);
  const skinGrain = keep(grain.clone());
  skinGrain.repeat.set(2, 2);
  // Matte clay throughout, on the two shaders the ground's stones and grass already use.
  const personMaterials = {
    sweater: keep(new MeshLambertMaterial({ map: knit, bumpMap: knit, bumpScale: 3 })),
    skin: keep(new MeshLambertMaterial({ bumpMap: skinGrain, bumpScale: 0.5 })),
    hair: keep(new MeshLambertMaterial({ bumpMap: skinGrain, bumpScale: 2 })),
    trousers: keep(new MeshLambertMaterial({ bumpMap: skinGrain, bumpScale: 1 })),
    shoe: keep(new MeshLambertMaterial()),
    dark: keep(new MeshLambertMaterial()),
    screen: keep(new MeshLambertMaterial()),
    white: keep(new MeshLambertMaterial()),
    pupil: keep(new MeshLambertMaterial()),
    lip: keep(new MeshLambertMaterial()),
    blush: keep(new MeshLambertMaterial()),
  };
  const person = keep(makePerson(personMaterials));
  const personZ = pathZ(PERSON_X) - 0.15;
  person.root.position.set(PERSON_X, hillSurface(PERSON_X, personZ), personZ);
  // Turned down the hill towards the crew, and a little towards us.
  person.root.rotation.y = Math.PI + 0.72;
  person.root.scale.setScalar(1.07);
  scene.add(person.root);
  const phoneGlowMaterial = keep(new SpriteMaterial(additive));
  const phoneGlow = new Sprite(phoneGlowMaterial);
  scene.add(phoneGlow);

  /* ---------------------------------------------------------------------------------------------- */

  const emberColor = new Color();
  const hotColor = new Color();

  function setPalette(next: HillPalette) {
    const c = (value: string) => cssColor(value, probe);
    const dusk = c(next.dusk);
    const dusk2 = c(next.dusk2);
    const hillColor = c(next.hill);
    const ink = c(next.ink);
    const muted = c(next.muted);
    const signal = c(next.signal);
    const shade = c(next.signalShade);
    const accent = c(next.accent);
    const mixed = (a: Color, b: Color, t: number) => a.clone().lerp(b, t);

    // The haze is the band's lower sky, so far hills fade into the section's own gradient.
    const haze = mixed(dusk2, accent, 0.14);
    (scene.fog as Fog).color.copy(haze);
    hemisphere.color.copy(mixed(ink, accent, 0.45));
    hemisphere.groundColor.copy(mixed(dusk, hillColor, 0.35));
    sky.color.copy(mixed(ink, accent, 0.4));
    rim.color.copy(mixed(signal, ink, 0.15));
    ember.color.copy(mixed(signal, ink, 0.1));

    // The hill is deep at its foot and lighter up its face, and warm near the crest, as the hero lights it.
    const low = mixed(hillColor, dusk, 0.72);
    const high = mixed(hillColor, dusk2, 0.42);
    const warm = mixed(high, signal, 0.32);
    const colors = hillGeometry.getAttribute("color");
    const vertex = new Color();
    for (let i = 0; i < colors.count; i += 1) {
      const x = hillPositions.getX(i);
      const y = hillPositions.getY(i);
      const z = hillPositions.getZ(i);
      vertex.copy(low).lerp(high, band(y, -2.2, 3.4));
      vertex.lerp(warm, 0.55 * Math.exp(-(((x - 4.6) / 3.6) ** 2)) * Math.exp(-(((z + 0.5) / 4.5) ** 2)));
      // The map is darker on the grass than on the path; lift the colour so the grass is the hill's own.
      colors.setXYZ(i, vertex.r / GRASS_SHADE, vertex.g / GRASS_SHADE, vertex.b / GRASS_SHADE);
    }
    colors.needsUpdate = true;
    rockMaterial.color.copy(mixed(hillColor, dusk2, 0.45));
    grassMaterial.color.copy(mixed(hillColor, dusk, 0.55));

    for (const ridge of ridges) {
      const top = mixed(mixed(hillColor, dusk, 0.5), haze, ridge.haze).lerp(signal, 0.1 * ridge.haze);
      const foot = mixed(top, haze, 0.6);
      const ridgeColors = ridge.geometry.getAttribute("color");
      for (let i = 0; i < ridgeColors.count; i += 1) {
        const color = i % 2 === 0 ? top : foot;
        ridgeColors.setXYZ(i, color.r, color.g, color.b);
      }
      ridgeColors.needsUpdate = true;
    }

    // The sky: clear at the top, where the band shows through, then haze, then the last warm light.
    const glowColor = mixed(mixed(signal, shade, 0.35), accent, 0.22);
    const gradient = skyContext.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, rgba(haze, 0));
    gradient.addColorStop(0.25, rgba(haze, 0.05));
    gradient.addColorStop(0.44, rgba(mixed(haze, accent, 0.25), 0.3));
    gradient.addColorStop(0.54, rgba(mixed(glowColor, haze, 0.5), 0.55));
    gradient.addColorStop(0.61, rgba(glowColor, 0.88));
    gradient.addColorStop(1, rgba(glowColor, 1));
    skyContext.clearRect(0, 0, 256, 256);
    skyContext.fillStyle = gradient;
    skyContext.fillRect(0, 0, 256, 256);
    // It thins towards its sides, so the canvas has no edge to show.
    const sides = skyContext.createLinearGradient(0, 0, 256, 0);
    sides.addColorStop(0.08, "rgba(0,0,0,0)");
    sides.addColorStop(0.36, "rgba(0,0,0,1)");
    sides.addColorStop(0.6, "rgba(0,0,0,1)");
    sides.addColorStop(0.92, "rgba(0,0,0,0)");
    skyContext.globalCompositeOperation = "destination-in";
    skyContext.fillStyle = sides;
    skyContext.fillRect(0, 0, 256, 256);
    skyContext.globalCompositeOperation = "source-over";
    skyTexture.needsUpdate = true;
    horizonMaterial.color.copy(glowColor);
    starMaterial.color.copy(mixed(ink, muted, 0.3));

    boulderMaterial.color.copy(mixed(signal, shade, 0.3));
    emberColor.copy(signal);
    hotColor.copy(mixed(signal, ink, 0.6));
    haloMaterial.color.copy(signal);
    beamMaterial.color.copy(mixed(signal, ink, 0.3));
    flashMaterial.color.copy(hotColor);
    rippleMaterial.color.copy(signal);
    sparkMaterial.color.copy(mixed(signal, ink, 0.25));
    poolMaterial.color.copy(mixed(signal, shade, 0.55));

    // The crew: pale shells of the illustrations' lavender clay, each a little deeper than the one ahead.
    shells.forEach((material, index) => material.color.copy(mixed(ink, accent, 0.26 + index * 0.13)));
    [next.trim1, next.trim2, next.trim3].forEach((value, index) => trims[index]!.color.copy(c(value)));
    dark.color.copy(mixed(dusk, accent, 0.22));
    visor.color.copy(mixed(dusk, accent, 0.06)).multiplyScalar(0.35);
    eye.color.copy(ink);
    eye.emissive.copy(mixed(ink, accent, 0.25));
    eye.emissiveIntensity = 1.6;
    tip.color.copy(signal);
    tip.emissive.copy(signal);
    for (const sprite of tipGlows) sprite.material.color.copy(signal);

    personMaterials.sweater.color.copy(mixed(ink, signal, 0.1));
    personMaterials.skin.color.copy(mixed(ink, shade, 0.42));
    personMaterials.hair.color.copy(mixed(dusk, shade, 0.4));
    personMaterials.trousers.color.copy(mixed(dusk2, accent, 0.4));
    personMaterials.shoe.color.copy(mixed(dusk, shade, 0.25));
    personMaterials.dark.color.copy(mixed(dusk, ink, 0.08));
    personMaterials.screen.color.copy(signal);
    personMaterials.screen.emissive.copy(mixed(signal, ink, 0.25));
    personMaterials.white.color.copy(ink);
    personMaterials.pupil.color.copy(mixed(dusk, shade, 0.12)).multiplyScalar(0.5);
    personMaterials.lip.color.copy(mixed(shade, dusk, 0.35));
    personMaterials.blush.color.copy(mixed(mixed(ink, shade, 0.42), signal, 0.4));
    phoneGlowMaterial.color.copy(signal);
  }

  /* ---------------------------------------------------------------------------------------------- */

  const normal = new Vector3();
  const centre = new Vector3();
  const reach = new Vector3();
  const watch = new Vector3();
  const tangent = new Vector3();
  const upward = new Vector3();
  const sideways = new Vector3();
  const forward = new Vector3();
  const facing = new Vector3();
  const basis = new Matrix4();
  const unroll = new Quaternion();

  /** A point `lift` above the path at x, measured square to the slope. */
  function onPath(x: number, lift: number, out: Vector3): Vector3 {
    const [px, py, pz] = pathPoint(x);
    normal.set(-pathSlope(x), 1, FACE).normalize();
    return out.set(px, py, pz).addScaledVector(normal, lift);
  }

  /**
   * Stands a bot on the path at x: leaning with the slope as far as `lean` says, and turned `about`
   * radians from facing up the path, round by the camera's side. Leaves `tangent` as the way up the path.
   */
  function stand(root: Object3D, x: number, aside: number, lean: number, about: number) {
    const [px, py, pz] = pathPoint(x);
    root.position.set(px, py, pz + aside);
    tangent.set(1, pathSlope(x) * lean, pathTurn(x)).normalize();
    sideways.crossVectors(tangent, upward.set(0, 1, 0)).normalize();
    upward.crossVectors(sideways, tangent);
    forward.copy(tangent).multiplyScalar(Math.cos(about)).addScaledVector(sideways, Math.sin(about));
    sideways.crossVectors(forward, upward);
    root.quaternion.setFromRotationMatrix(basis.makeBasis(forward, upward, sideways));
  }

  function render(progress: number) {
    const p = ((progress % 1) + 1) % 1;
    const turn = p * Math.PI * 2;
    const seconds = p * IDLE_BEATS;
    const x = START_X + (TOP_X - START_X) * climb(p);
    const travelled = pathLength(START_X, x);

    // The call is made: the stone gathers light, lifts, and is gone up a column of it.
    const charge = band(p, BEATS.charge, BEATS.flash);
    const gone = band(p, BEATS.flash, BEATS.flash + 0.014);
    const fading = 1 - band(p, BEATS.flash, BEATS.dark);
    // Its light comes up while it is still below the frame, so the loop begins as dark as it ended.
    const lit = band(p, 0, 0.03) * fading;
    const pulse = 0.5 + 0.5 * Math.sin(turn * 7);

    // The boulder rolls as far as it climbs: its turn is the ground covered over its radius.
    onPath(x, BOULDER_R * 0.95, centre);
    holder.position.copy(centre);
    holder.position.y += 0.3 * charge * charge + 2.4 * gone;
    boulder.rotation.set(0, -Math.atan(pathTurn(x)), -travelled / BOULDER_R - 1.2 * charge * charge);
    holder.scale.set(1 - 0.93 * gone, 1 + 1.6 * gone, 1 - 0.93 * gone);
    boulderMaterial.opacity = 1 - gone * gone;
    holder.visible = gone < 0.99;
    boulderMaterial.emissive.copy(emberColor).lerp(hotColor, 0.75 * charge);
    boulderMaterial.emissiveIntensity = 1.2 + 0.08 * pulse + 2.4 * charge * charge;
    halo.position.copy(holder.position).add(reach.set(0, 0, -0.4));
    halo.scale.setScalar(BOULDER_R * (4.8 + 0.2 * pulse + 2.6 * charge));
    haloMaterial.opacity = (0.6 + 0.3 * charge) * lit;
    ember.position.copy(holder.position);
    ember.intensity = (16 + 1.5 * pulse + 34 * charge) * lit;
    onPath(x, 0.03, pool.position);
    pool.quaternion.setFromUnitVectors(upward.set(0, 1, 0), normal);
    pool.scale.set(8.5, 1, 6);
    poolMaterial.opacity = (0.22 + 0.3 * charge) * lit;
    onPath(x, 0.04, contact.position);
    contact.quaternion.copy(pool.quaternion);
    contact.scale.set(1.5, 1, 1.25);
    contactMaterial.opacity = 0.5 * (1 - charge);

    onPath(x, 0.02, beam.position);
    const struck = band(p, BEATS.flash - 0.008, BEATS.flash + 0.006);
    const thinning = band(p, BEATS.flash + 0.008, BEATS.dark);
    beam.scale.set(BOULDER_R * (0.9 + 1.9 * struck) * (1 - 0.9 * thinning), 15, 1);
    beamMaterial.opacity = band(p, BEATS.charge + 0.008, BEATS.flash) * (1 - thinning) * (0.5 + 0.5 * struck);
    beam.visible = beamMaterial.opacity > 0.005;
    flash.position.copy(centre).add(reach.set(0, 0.3, 0.6));
    flashMaterial.opacity = p < BEATS.flash ? band(p, BEATS.flash - 0.012, BEATS.flash) : 1 - band(p, BEATS.flash, BEATS.flash + 0.04);
    flash.scale.setScalar(BOULDER_R * (3 + 11 * band(p, BEATS.flash - 0.012, BEATS.flash + 0.03)));
    flash.visible = flashMaterial.opacity > 0.005;
    const spread = clamp01((p - BEATS.flash) / 0.055);
    ripple.position.copy(pool.position);
    ripple.quaternion.copy(pool.quaternion);
    ripple.scale.set(1.6 + 9 * Math.sqrt(spread), 1, 1.3 + 7 * Math.sqrt(spread));
    rippleMaterial.opacity = p < BEATS.flash ? 0 : 0.85 * (1 - spread) ** 1.5;
    ripple.visible = rippleMaterial.opacity > 0.005;
    // Embers thrown out by the flash drift up and die.
    const since = ((p - BEATS.flash) * LOOP_SECONDS) / 1.5;
    sparks.visible = since > 0 && since < 1;
    if (sparks.visible) {
      for (let i = 0; i < SPARKS; i += 1) {
        const [vx, vy, vz, life] = sparkPaths[i]!;
        const t = Math.min(since / life, 1);
        const flown = 1 - (1 - t) ** 2;
        sparkPositions.setXYZ(i, centre.x + vx * flown, centre.y + vy * flown + 1.6 * since * since, centre.z + vz * flown);
      }
      sparkPositions.needsUpdate = true;
      sparkMaterial.opacity = (1 - since) ** 1.2;
      sparkMaterial.size = 0.5 * (1 - 0.6 * since);
    }

    // The crew climbs with it, stands back at the top, cheers the call, then turns and walks back down.
    const push = 1 - band(p, BEATS.top - 0.004, BEATS.top + 0.045);
    const cheer = band(p, BEATS.flash, BEATS.flash + 0.025) * (1 - band(p, BEATS.turn - 0.03, BEATS.turn));
    const about = Math.PI * band(p, BEATS.turn, BEATS.turn + 0.035);
    const walk = band(p, BEATS.descend, BEATS.descend + 0.02);
    const down = DESCENT * descend(p);
    boulder.getWorldQuaternion(unroll).invert();
    crew.forEach((member, index) => {
      const { bot } = member;
      // Where the wrists go: on the stone for the first of them, on the pack ahead for the others.
      const reachOut = () => {
        for (const hand of [0, 1] as const) {
          if (index === 0) {
            bot.shoulder(hand, reach).sub(centre);
            reach.y += 0.3;
            reach.normalize();
            const { dent } = stoneAt(...facing.copy(reach).applyQuaternion(unroll).toArray(), false);
            member.hands[hand].copy(centre).addScaledVector(reach, BOULDER_R * (1 + dent) + PALM * member.scale);
          } else {
            crew[index - 1]!.bot.back(hand, member.hands[hand], facing);
            member.hands[hand].addScaledVector(facing, PALM * member.scale);
          }
        }
      };
      // Mostly eyes on the work; now and then one of them looks round at us.
      const glance = Math.max(0, Math.sin(turn * 3 + index * 2.1)) ** 6;
      const pose = () =>
        bot.pose({
          push,
          cheer,
          walk,
          distance: travelled + down,
          seconds,
          hands: member.hands,
          headTurn: (member.turn + 0.5 * glance) * push + (0.3 + 0.12 * index) * (1 - push) * (1 - walk) + 0.35 * cheer - (0.3 + 0.55 * glance) * walk,
          headTilt: 0.06 * Math.sin(turn * 4 + index) + (0.32 - 0.05 * index) * (1 - push) * (1 - walk),
          blink: (seconds / 3.25 + index * 0.37) % 1 < 0.04,
        });
      // Stood back from the load once it rests. While it pushes, each one closes up until its hands are on what is ahead.
      const nominal = x - (member.behind + 0.2 * (1 - push)) * 0.94 - down;
      for (let settle = 0; settle < (push > 0 ? 3 : 0); settle += 1) {
        stand(bot.root, nominal + member.fit * push, member.aside, 0.35 + 0.65 * push, about);
        pose();
        reachOut();
        const wrists = reach.copy(member.hands[0]).add(member.hands[1]).multiplyScalar(0.5);
        const shoulders = bot.shoulder(0, facing).add(bot.shoulder(1, forward)).multiplyScalar(0.5);
        member.fit += (wrists.sub(shoulders).dot(tangent) - REACH * member.scale) * tangent.x;
      }
      stand(bot.root, nominal + member.fit * push, member.aside, 0.35 + 0.65 * push, about);
      pose();
      if (push > 0) {
        reachOut();
        pose();
      }
    });
    crew.forEach((member, index) => {
      const sprite = tipGlows[index]!;
      member.bot.tipAt(sprite.position);
      sprite.scale.setScalar(member.scale * (0.5 + 0.45 * cheer + 0.08 * Math.sin(seconds * 4.83 + index)));
      sprite.material.opacity = 0.55;
    });
    tip.emissiveIntensity = 1.3 + 1.2 * cheer;

    // The person reads the question when the card arrives, taps the answer, smiles, and holds it up.
    const tap = Math.exp(-(((p - BEATS.tap) / 0.012) ** 2));
    const lowered = 1 - band(p, BEATS.turn - 0.025, BEATS.turn + 0.015);
    const show = band(p, BEATS.tap + 0.008, BEATS.flash - 0.005) * lowered;
    const read = band(p, BEATS.top + 0.005, BEATS.top + 0.05) * (1 - band(p, BEATS.tap + 0.008, BEATS.flash - 0.005));
    const smile = band(p, BEATS.tap - 0.004, BEATS.tap + 0.02) * (1 - band(p, BEATS.turn + 0.02, BEATS.turn + 0.1));
    // They watch the boulder while there is one, then the crew on its way down.
    if (gone < 0.5) watch.copy(holder.position).y -= 0.4;
    else watch.copy(crew[0]!.bot.root.position).y += 0.9;
    person.pose({ seconds, read, tap, show, smile, watch, blink: (seconds / 4.3333 + 0.2) % 1 < 0.03 });
    const held = Math.max(read, show);
    personMaterials.screen.emissiveIntensity = 0.55 + 1.5 * held + 0.6 * tap;
    person.phoneAt(phoneGlow.position);
    phoneGlow.scale.setScalar(0.5 + 0.55 * held + 0.5 * show);
    phoneGlowMaterial.opacity = 0.22 + 0.4 * held + 0.3 * tap;

    // The camera drifts, slowly, and comes back to where it began as the loop does.
    camera.position.set(cameraHome.x + 0.34 * Math.sin(turn), cameraHome.y + 0.1 * Math.sin(turn * 2), cameraHome.z - 0.3 * Math.cos(turn));
    camera.lookAt(reach.set(lookAt.x + 0.12 * Math.sin(turn), lookAt.y, lookAt.z));

    renderer.render(scene, camera);
  }

  let quality = 1;
  const size = { width: 0, height: 0 };

  function setQuality(scale: number) {
    if (scale === quality) return;
    quality = scale;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1) * scale);
    if (size.width) renderer.setSize(size.width, size.height, false);
    sky.shadow.mapSize.setScalar(scale < 1 ? 512 : 1024);
    sky.shadow.map?.dispose();
    sky.shadow.map = null;
  }

  function resize(width: number, height: number) {
    if (!width || !height) return;
    size.width = width;
    size.height = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Frame the hill by its width: the slope from the foot to the person at the top always fits.
    const span = 13.5;
    const horizontal = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
    const distance = Math.max(11, span / 2 / Math.tan(horizontal / 2));
    // From a little above, and from a little up the hill, so the face of the hill and the crew's faces show.
    cameraHome.set(lookAt.x - distance * 0.05, lookAt.y + distance * 0.22, distance * 0.98);
    camera.updateProjectionMatrix();
  }

  setPalette(palette);
  // Where the browser can build shaders off the main thread, wait for them there rather than stall the first frame.
  if (renderer.extensions.has("KHR_parallel_shader_compile")) await renderer.compileAsync(scene, camera);

  return {
    setPalette,
    render,
    resize,
    setQuality,
    dispose() {
      for (const item of disposables) item.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
