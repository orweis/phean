import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
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
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";

import { makeBot, makeBotKit, type BotLook, type BotMaterials } from "./hill/bot";
import { band, clamp01, fbm } from "./hill/noise";
import { makePerson } from "./hill/person";
import { Parts } from "./hill/rig";
import { FACE, hillSurface, pathLength, pathPoint, pathSlope, pathTurn, pathZ } from "./hill/terrain";
import { boulderMaps, glowMap, grainMap, GRASS_SHADE, GROUND, groundMap, knitMap, panelMap, shadowMap, stoneAt } from "./hill/textures";

/**
 * The name, in clay: the hero illustration, moving. Three robot agents push the ember boulder up a
 * long violet hill at dusk, along the path worn into it; the boulder slips, and they catch it. At
 * the crest a person reads the one question the crew stopped for, taps the answer and holds it up;
 * the crew cheers, and the next boulder is already waiting at the foot. Every colour is the theme's.
 *
 * One loop is `progress` 0..1, the same 13 seconds as `--hill` in globals.css, so the decision card
 * the figure shows over the scene appears as the boulder reaches the top.
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
  /** Draws the loop at `progress` (0..1); `seconds` drives the idle motion, and wraps with the loop. */
  render(progress: number, seconds: number): void;
  resize(width: number, height: number): void;
  /** 1 is the full picture; less draws fewer pixels and a coarser shadow, for a device that cannot keep up. */
  setQuality(scale: number): void;
  dispose(): void;
}

/* ---------------------------------------------------------------------------------------------- */

const BOULDER_R = 1.02;
/** Where along the path the boulder starts and stops, as x; the person stands past the top. */
const START_X = -3.5;
const TOP_X = 2.55;
const PERSON_X = 5.05;
/** The crew, nose to tail as the hero draws them: how far behind the boulder's centre each one's feet are. */
const CREW: (BotLook & { behind: number; aside: number; turn: number })[] = [
  { scale: 0.96, behind: 1.7, aside: 0.12, turn: 0.75, antenna: 0.2, antennaAt: 0.06, antennaLean: -0.12 },
  { scale: 0.87, behind: 2.58, aside: 0.3, turn: 0.95, antenna: 0.13, antennaAt: -0.08, antennaLean: -0.3 },
  { scale: 0.79, behind: 3.4, aside: 0.1, turn: 0.6, antenna: 0.27, antennaAt: 0, antennaLean: 0.05 },
];

/** The climb, 0 at the foot to 1 at the top, with the slip Sisyphus knows: it rolls back a little and is caught. */
function climb(p: number): number {
  const up = p / 0.52;
  const eased = up <= 0 ? 0 : up >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * up);
  const slip = Math.sin(Math.PI * clamp01((up - 0.5) / 0.16));
  return eased - 0.045 * slip * (up < 1 ? 1 : 0);
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

  /* The boulder, and the next one waiting at the foot. It is the scene's lamp, so it casts no shadow of its own. */
  const stoneMaterial = () =>
    keep(
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
  const boulderMaterial = stoneMaterial();
  const boulder = new Mesh(stoneGeometry, boulderMaterial);
  scene.add(boulder);
  const nextMaterial = stoneMaterial();
  const nextBoulder = new Mesh(stoneGeometry, nextMaterial);
  nextBoulder.rotation.set(0.6, 1.1, 0.3);
  scene.add(nextBoulder);

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
    return { ...look, bot, hands: [new Vector3(), new Vector3()] as const };
  });
  // They fade in and out with the loop, so their materials blend; at full opacity that draws as solid.
  const crewMaterials = [dark, visor, eye, tip, ...shells, ...trims];
  for (const material of crewMaterials) material.transparent = true;
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
  };
  const person = keep(makePerson(personMaterials));
  const personZ = pathZ(PERSON_X) - 0.15;
  person.root.position.set(PERSON_X, hillSurface(PERSON_X, personZ), personZ);
  // Turned down the hill towards the crew, and a little towards us.
  person.root.rotation.y = Math.PI + 0.62;
  person.root.scale.setScalar(1.07);
  scene.add(person.root);
  const phoneGlowMaterial = keep(new SpriteMaterial(additive));
  const phoneGlow = new Sprite(phoneGlowMaterial);
  scene.add(phoneGlow);

  /* ---------------------------------------------------------------------------------------------- */

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

    for (const material of [boulderMaterial, nextMaterial]) {
      material.color.copy(mixed(signal, shade, 0.3));
      material.emissive.copy(signal);
    }
    haloMaterial.color.copy(signal);
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
    phoneGlowMaterial.color.copy(signal);
  }

  /* ---------------------------------------------------------------------------------------------- */

  const normal = new Vector3();
  const centre = new Vector3();
  const reach = new Vector3();
  const watch = new Vector3();

  /** A point `lift` above the path at x, measured square to the slope. */
  function onPath(x: number, lift: number, out: Vector3): Vector3 {
    const [px, py, pz] = pathPoint(x);
    normal.set(-pathSlope(x), 1, FACE).normalize();
    return out.set(px, py, pz).addScaledVector(normal, lift);
  }

  function render(progress: number, seconds: number) {
    const p = ((progress % 1) + 1) % 1;
    const turn = p * Math.PI * 2;
    const x = START_X + (TOP_X - START_X) * climb(p);
    const travelled = pathLength(START_X, x);

    // The boulder rolls as far as it climbs: its turn is the ground covered over its radius.
    onPath(x, BOULDER_R * 0.95, boulder.position);
    boulder.rotation.set(0, -Math.atan(pathTurn(x)), -travelled / BOULDER_R);
    const handOver = band(p, 0.86, 0.95);
    boulderMaterial.opacity = 1 - handOver;
    boulder.visible = boulderMaterial.opacity > 0.01;
    nextMaterial.opacity = p > 0.5 ? band(p, 0.84, 0.95) : 0;
    nextBoulder.visible = nextMaterial.opacity > 0.01;
    onPath(START_X, BOULDER_R * 0.95, nextBoulder.position);

    // At the top, the call is made: the stone brightens while the card shows the pick.
    const done = band(p, 0.67, 0.72) * (1 - band(p, 0.84, 0.9));
    const pulse = 0.5 + 0.5 * Math.sin(turn * 5);
    boulderMaterial.emissiveIntensity = 1.2 + 0.3 * done + 0.08 * pulse;
    nextMaterial.emissiveIntensity = 1.2;
    const active = boulder.visible && handOver < 0.5 ? boulder : nextBoulder;
    centre.copy(active.position);
    halo.position.copy(centre).add(reach.set(0, 0, -0.4));
    halo.scale.setScalar(BOULDER_R * (4.8 + 1.2 * done + 0.2 * pulse));
    haloMaterial.opacity = 0.6 + 0.22 * done;
    ember.position.copy(centre);
    ember.intensity = 16 + 7 * done + 1.5 * pulse;
    const under = active === boulder ? x : START_X;
    onPath(under, 0.03, pool.position);
    pool.rotation.z = Math.atan(pathSlope(under));
    pool.scale.set(8.5, 1, 6);
    poolMaterial.opacity = 0.22 + 0.1 * done;
    onPath(under, 0.04, contact.position);
    contact.rotation.z = pool.rotation.z;
    contact.scale.set(1.5, 1, 1.25);
    contactMaterial.opacity = 0.5;

    // The crew climbs with it, stands back at the top, cheers the call, and is at the foot again for the next.
    const atFoot = p >= 0.9;
    const push = atFoot ? 1 : 1 - band(p, 0.515, 0.57);
    const cheer = band(p, 0.69, 0.73) * (1 - band(p, 0.8, 0.85));
    const crewOpacity = clamp01(p < 0.5 ? band(p, -0.06, 0.04) : atFoot ? band(p, 0.9, 1.04) : 1 - band(p, 0.83, 0.9));
    for (const material of crewMaterials) material.opacity = crewOpacity;
    const crewX = atFoot ? START_X : x;
    const walked = atFoot ? 0 : travelled;
    onPath(crewX, BOULDER_R * 0.95, centre);
    // Twice: the second pass puts the hands where the first pass put the shoulders within reach of.
    for (let pass = 0; pass < 2; pass += 1) {
      crew.forEach((member, index) => {
        const { bot } = member;
        // Stood back from the load once it rests.
        const ax = crewX - (member.behind + 0.22 * (1 - push)) * 0.94;
        const [px, py, pz] = pathPoint(ax);
        bot.root.position.set(px, py, pz + member.aside);
        bot.root.rotation.set(0, -Math.atan(pathTurn(ax)), Math.atan(pathSlope(ax)) * (0.35 + 0.65 * push));
        bot.root.visible = crewOpacity > 0.01;
        if (pass === 1) {
          for (const hand of [0, 1] as const) {
            if (index === 0) {
              bot.shoulder(hand, reach).sub(centre);
              reach.y += 0.32;
              member.hands[hand].copy(centre).addScaledVector(reach.normalize(), BOULDER_R * 1.05);
            } else {
              crew[index - 1]!.bot.back(member.hands[hand]);
              member.hands[hand].z += (hand === 0 ? 0.1 : -0.1) * member.scale;
              member.hands[hand].x -= 0.05;
            }
          }
        }
        // Mostly eyes on the work; now and then one of them looks round at us.
        const glance = Math.max(0, Math.sin(turn * 2 + index * 2.1)) ** 6;
        bot.pose({
          push,
          cheer,
          distance: walked,
          seconds,
          hands: member.hands,
          headTurn: member.turn * push + 0.5 * glance * push + (0.3 + 0.12 * index) * (1 - push) + 0.35 * cheer,
          headTilt: 0.06 * Math.sin(turn * 3 + index) + (0.32 - 0.05 * index) * (1 - push),
          blink: (seconds / 3.25 + index * 0.37) % 1 < 0.04,
        });
      });
    }
    crew.forEach((member, index) => {
      const sprite = tipGlows[index]!;
      sprite.visible = member.bot.root.visible;
      member.bot.tipAt(sprite.position);
      sprite.scale.setScalar(member.scale * (0.5 + 0.45 * cheer + 0.08 * Math.sin(seconds * 4.83 + index)));
      sprite.material.opacity = 0.55 * crewOpacity;
    });
    tip.emissiveIntensity = 1.3 + 1.2 * cheer;

    // The person reads the question when the card arrives, taps the answer, and holds it up.
    const tap = Math.exp(-(((p - 0.664) / 0.014) ** 2));
    const show = band(p, 0.685, 0.73) * (1 - band(p, 0.84, 0.9));
    const read = band(p, 0.52, 0.575) * (1 - band(p, 0.685, 0.73));
    watch.copy(boulder.visible ? boulder.position : nextBoulder.position);
    watch.y -= 0.4;
    person.pose({ seconds, read, tap, show, watch });
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
