import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
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
} from "three";

import { loadAvatar } from "./hill/avatar-model";
import { makeBot, makeBotKit, type BotMaterials } from "./hill/bot";
import { BOULDER_PATTERNS } from "./hill/cast";
import { BEATS, BOULDER_R, CREW, LOOP_SECONDS, onPath, placeBoulder, placeCrew, scoreAt, type Branch, type Member } from "./hill/crew";
import { band, clamp01, fbm } from "./hill/noise";
import { ink, Parts } from "./hill/rig";
import { hillSurface, pathZ } from "./hill/terrain";
import { ASPECT, cameraAt, FOV, LOOK_PLANE, pointOn, HORIZON, PERSON_HEIGHT, PERSON_X, PERSON_Z, RIDGE_DROP, ridgeHalf, RIDGES, ridgeTop, SKY, SKY_STOPS, starAt, STARS } from "./hill/view";
import { beamMap, boulderMaps, type BoulderMaps, glowMap, grainMap, GRASS_SHADE, GROUND, groundMap, panelMap, ringMap, shadowMap, stoneAt, toonRamp } from "./hill/textures";

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

/** One frame: everything it is drawn from. */
export interface HillFrame {
  /** 0..1 through the loop. */
  progress: number;
  /** The idle clock, in beats (13 to a loop), for motion that runs on through a hold; left out, it follows the loop. */
  idle?: number;
  /** How the call went, for the rest of the loop it was made in. */
  branch?: Branch;
  /** Which loop this is, from 1: it decides the boulder. */
  loop?: number;
  /** Where the crew looks while it waits: a point on the figure (0..1 across and down it), and how much they attend to it (0..1). */
  look?: { x: number; y: number; weight: number };
}

export interface HillScene {
  setPalette(palette: HillPalette): void;
  /** Draws the loop at `progress` (0..1). */
  render(frame: HillFrame): void;
  resize(width: number, height: number): void;
  /** 1 is the full picture; less draws fewer pixels and a coarser shadow, for a device that cannot keep up. */
  setQuality(scale: number): void;
  dispose(): void;
}

/* ---------------------------------------------------------------------------------------------- */

/** A stone for the crew to push: a sphere dented into plates, split where the cracks of its texture run. */
function boulderGeometry(pattern: number): SphereGeometry {
  const geometry = new SphereGeometry(BOULDER_R, 96, 64);
  const position = geometry.getAttribute("position");
  const point = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i).normalize();
    const { dent } = stoneAt(point.x, point.y, point.z, false, pattern);
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

  // Painted first, a step at a time: the stones (each loop's boulder is one of a few), the ground, then the small maps.
  const stones: { maps: BoulderMaps; geometry: SphereGeometry }[] = [];
  for (let pattern = 0; pattern < BOULDER_PATTERNS; pattern += 1) {
    const maps = boulderMaps(pattern);
    keep(maps.map);
    keep(maps.emissiveMap);
    keep(maps.detail);
    stones.push({ maps, geometry: keep(boulderGeometry(pattern)) });
    await breathe();
  }
  const ground = keep(groundMap());
  await breathe();
  const grain = keep(grainMap());
  const glow = keep(glowMap());
  const panels = keep(panelMap());
  await breathe();

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  scene.fog = new Fog(0x000000, 16, 46);

  const camera = new PerspectiveCamera(FOV, ASPECT, 0.5, 90);

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
  const ridgeMaterial = keep(new MeshBasicMaterial({ vertexColors: true, fog: false }));
  const ridges = RIDGES.map((ridge) => {
    const columns = 72;
    const positions: number[] = [];
    const indices: number[] = [];
    const half = ridgeHalf(ridge);
    for (let i = 0; i <= columns; i += 1) {
      const x = -half + (2 * half * i) / columns;
      const top = ridgeTop(ridge, x);
      positions.push(x, top, ridge.z, x, ridge.base - RIDGE_DROP, ridge.z);
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
  const skyPlane = new Mesh(keep(new PlaneGeometry(SKY.width, SKY.height)), skyMaterial);
  skyPlane.position.set(SKY.x, SKY.y, SKY.z);
  skyPlane.renderOrder = -2;
  scene.add(skyPlane);

  /* A few stars, high in the band. */
  const starPositions: number[] = [];
  for (let i = 0; i < STARS; i += 1) starPositions.push(...starAt(i));
  const starGeometry = keep(new BufferGeometry());
  starGeometry.setAttribute("position", new Float32BufferAttribute(starPositions, 3));
  const starMaterial = keep(new PointsMaterial({ size: 0.16, transparent: true, opacity: 0.75, fog: false, depthWrite: false }));
  scene.add(new Points(starGeometry, starMaterial));

  /* The boulder. It is the scene's lamp, so it casts no shadow of its own. */
  const boulderMaterial = keep(
    new MeshStandardMaterial({
      map: stones[0]!.maps.map,
      emissiveMap: stones[0]!.maps.emissiveMap,
      bumpMap: stones[0]!.maps.detail,
      bumpScale: 3.5,
      roughnessMap: stones[0]!.maps.detail,
      roughness: 1,
      metalness: 0,
      transparent: true,
    }),
  );
  const boulder = new Mesh(stones[0]!.geometry, boulderMaterial);
  // The other stones' maps go to the GPU now, so that changing boulders between loops costs nothing then.
  for (const stone of stones) for (const map of [stone.maps.map, stone.maps.emissiveMap, stone.maps.detail]) renderer.initTexture(map);
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

  const horizonMaterial = keep(new SpriteMaterial({ ...additive, opacity: HORIZON.strength }));
  const horizon = new Sprite(horizonMaterial);
  horizon.position.set(HORIZON.x, HORIZON.y, HORIZON.z);
  horizon.scale.set(HORIZON.width, HORIZON.height, 1);
  horizon.renderOrder = -1;
  scene.add(horizon);

  /* The crew: one kit of parts, three bots, each with its own shell tint and trim. */
  const kit = keep(makeBotKit());
  // Cel shading for the characters: light in flat steps, and an ink line round every shape (each drawn again, swollen and inside out).
  const ramp = keep(toonRamp());
  const inkMaterial = keep(new MeshBasicMaterial({ side: BackSide }));
  inkMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "vec3 transformed = position + normalize(normal) * 0.0105;");
  };
  const dark = keep(new MeshToonMaterial({ gradientMap: ramp }));
  const visor = keep(new MeshToonMaterial({ gradientMap: ramp }));
  const eye = keep(new MeshToonMaterial({ gradientMap: ramp }));
  const tip = keep(new MeshToonMaterial({ gradientMap: ramp }));
  const shells: MeshToonMaterial[] = [];
  const trims: MeshToonMaterial[] = [];
  const crew = CREW.map((look) => {
    const shell = keep(new MeshToonMaterial({ gradientMap: ramp, map: panels, bumpMap: panels, bumpScale: 2 }));
    const trim = keep(new MeshToonMaterial({ gradientMap: ramp }));
    shells.push(shell);
    trims.push(trim);
    const materials: BotMaterials = { shell, dark, trim, visor, eye, tip };
    const bot = keep(makeBot(kit, materials, look));
    ink(bot.inked, inkMaterial);
    scene.add(bot.root);
    return { ...look, bot, hands: [new Vector3(), new Vector3()] as const } satisfies Member;
  });
  const tipGlows = crew.map(() => {
    const sprite = new Sprite(keep(new SpriteMaterial(additive)));
    scene.add(sprite);
    return sprite;
  });

  /* You, at the top: the model is fetched here, and the scene waits for it so that it is whole when it shows. Without it the hill has no person. */
  const person = await loadAvatar(PERSON_HEIGHT, ramp).catch(() => null);
  if (person) {
    keep(person);
    person.root.position.set(PERSON_X, hillSurface(PERSON_X, PERSON_Z), PERSON_Z);
    // Turned down the hill towards the crew, and a little towards us.
    person.root.rotation.y = Math.PI + 0.72;
    scene.add(person.root, person.phone);
  }
  const phoneGlowMaterial = keep(new SpriteMaterial(additive));
  const phoneGlow = new Sprite(phoneGlowMaterial);
  scene.add(phoneGlow);

  /* ---------------------------------------------------------------------------------------------- */

  const emberColor = new Color();
  const stoneColor = new Color();
  const paleColor = new Color();
  const deepColor = new Color();
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
    // Haze high up, the horizon's glow low down, and the two mixed between.
    SKY_STOPS.forEach(([at, strength], index) => {
      const warmth = [0, 0, 0, 0.5, 1, 1][index]!;
      gradient.addColorStop(at, rgba(index === 2 ? mixed(haze, accent, 0.25) : mixed(haze, glowColor, warmth), strength));
    });
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

    stoneColor.copy(mixed(signal, shade, 0.3));
    emberColor.copy(signal);
    paleColor.copy(mixed(signal, ink, 0.5));
    deepColor.copy(shade);
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
    inkMaterial.color.copy(mixed(dusk, accent, 0.1)).multiplyScalar(0.35);
    dark.color.copy(mixed(dusk, accent, 0.22));
    visor.color.copy(mixed(dusk, accent, 0.06)).multiplyScalar(0.35);
    eye.color.copy(ink);
    eye.emissive.copy(mixed(ink, accent, 0.25));
    eye.emissiveIntensity = 1.6;
    visor.emissive.set(0x000000);
    tip.color.copy(signal);
    tip.emissive.copy(signal);
    for (const sprite of tipGlows) sprite.material.color.copy(signal);

    if (person) {
      for (const line of person.lines) line.color.copy(inkMaterial.color);
      person.phoneBody.color.copy(mixed(dusk, ink, 0.08));
      person.phoneScreen.color.copy(signal);
      person.phoneScreen.emissive.copy(mixed(signal, ink, 0.25));
    }
    phoneGlowMaterial.color.copy(signal);
  }

  /* ---------------------------------------------------------------------------------------------- */

  const normal = new Vector3();
  const centre = new Vector3();
  const reach = new Vector3();
  const watch = new Vector3();
  const upward = new Vector3();
  const turned = new Quaternion();
  const gaze = new Vector3();

  function render({ progress, idle, branch, loop, look }: HillFrame) {
    const score = scoreAt(progress, idle, branch, loop);
    // The boulder's leaving in light is the shipped call's; held a week, it rolls away instead.
    const shipped = score.branch === "ship";
    const { p, turn, seconds, x, charge, gone, cheer } = score;
    // Its light comes up while it is still below the frame, so the loop begins as dark as it ended.
    const lit = band(p, 0, 0.03) * score.fading;
    const pulse = 0.5 + 0.5 * Math.sin(turn * 7);

    // The boulder rolls as far as it climbs: its turn is the ground covered over its radius.
    // This loop's boulder: its stone, its size, and how warm it burns.
    const { pattern, radius, warmth } = score.boulder;
    const stone = stones[pattern]!;
    const size = radius / BOULDER_R;
    if (boulder.geometry !== stone.geometry) {
      boulder.geometry = stone.geometry;
      boulderMaterial.map = stone.maps.map;
      boulderMaterial.emissiveMap = stone.maps.emissiveMap;
      boulderMaterial.bumpMap = boulderMaterial.roughnessMap = stone.maps.detail;
    }
    boulder.scale.setScalar(size);
    placeBoulder(score, centre, turned);
    boulder.quaternion.copy(turned);
    holder.position.copy(centre);
    holder.position.y += 0.3 * charge * charge + 2.4 * gone;
    holder.scale.set(1 - 0.93 * gone, 1 + 1.6 * gone, 1 - 0.93 * gone);
    boulderMaterial.opacity = 1 - gone * gone;
    holder.visible = gone < 0.99;
    boulderMaterial.color.copy(stoneColor).lerp(warmth > 0 ? paleColor : deepColor, 0.3 * Math.abs(warmth));
    boulderMaterial.emissive.copy(emberColor).lerp(warmth > 0 ? paleColor : deepColor, 0.3 * Math.abs(warmth)).lerp(hotColor, 0.75 * charge);
    boulderMaterial.emissiveIntensity = 1.2 + 0.08 * pulse + 2.4 * charge * charge;
    halo.position.copy(holder.position).add(reach.set(0, 0, -0.4));
    halo.scale.setScalar(radius * (4.8 + 0.2 * pulse + 2.6 * charge));
    haloMaterial.opacity = (0.6 + 0.3 * charge) * lit;
    ember.position.copy(holder.position);
    ember.intensity = (16 + 1.5 * pulse + 16 * charge) * lit;
    onPath(x, 0.03, pool.position, normal);
    pool.quaternion.setFromUnitVectors(upward.set(0, 1, 0), normal);
    pool.scale.set(8.5 * size, 1, 6 * size);
    poolMaterial.opacity = (0.22 + 0.3 * charge) * lit;
    onPath(x, 0.04, contact.position);
    contact.quaternion.copy(pool.quaternion);
    contact.scale.set(1.5 * size, 1, 1.25 * size);
    contactMaterial.opacity = 0.5 * (1 - charge);

    onPath(x, 0.02, beam.position);
    const struck = band(p, BEATS.flash - 0.008, BEATS.flash + 0.006);
    const thinning = band(p, BEATS.flash + 0.008, BEATS.dark);
    beam.scale.set(radius * (0.9 + 1.9 * struck) * (1 - 0.9 * thinning), 15, 1);
    beamMaterial.opacity = shipped ? band(p, BEATS.charge + 0.008, BEATS.flash) * (1 - thinning) * (0.5 + 0.5 * struck) : 0;
    beam.visible = beamMaterial.opacity > 0.005;
    flash.position.copy(centre).add(reach.set(0, 0.3, 0.6));
    flashMaterial.opacity = !shipped ? 0 : p < BEATS.flash ? band(p, BEATS.flash - 0.012, BEATS.flash) : 1 - band(p, BEATS.flash, BEATS.flash + 0.04);
    flash.scale.setScalar(radius * (3 + 11 * band(p, BEATS.flash - 0.012, BEATS.flash + 0.03)));
    flash.visible = flashMaterial.opacity > 0.005;
    const spread = clamp01((p - BEATS.flash) / 0.055);
    ripple.position.copy(pool.position);
    ripple.quaternion.copy(pool.quaternion);
    ripple.scale.set(1.6 + 9 * Math.sqrt(spread), 1, 1.3 + 7 * Math.sqrt(spread));
    rippleMaterial.opacity = p < BEATS.flash || !shipped ? 0 : 0.85 * (1 - spread) ** 1.5;
    ripple.visible = rippleMaterial.opacity > 0.005;
    // Embers thrown out by the flash drift up and die.
    const since = ((p - BEATS.flash) * LOOP_SECONDS) / 1.5;
    sparks.visible = shipped && since > 0 && since < 1;
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
    // While it waits, the crew looks where the visitor points: a spot in the air a little our side of the path.
    const attention = look && look.weight > 0.001 ? { point: gaze.set(...pointOn(camera.aspect, turn, look.x, look.y, LOOK_PLANE)), weight: look.weight } : undefined;
    placeCrew(score, crew, centre, turned, attention);
    crew.forEach((member, index) => {
      const sprite = tipGlows[index]!;
      member.bot.tipAt(sprite.position);
      sprite.scale.setScalar(member.scale * (0.5 + 0.45 * cheer + 0.08 * Math.sin(seconds * 4.83 + index)));
      sprite.material.opacity = 0.55;
    });
    tip.emissiveIntensity = 1.3 + 1.2 * cheer;

    // The person reads the question when the card arrives, taps the answer, smiles, and holds it up.
    const { tap, show, read, smile, joy, shrug } = score;
    // They watch the boulder while there is one, then the crew on its way down.
    if (gone < 0.5) watch.copy(holder.position).y -= 0.4;
    else watch.copy(crew[0]!.bot.root.position).y += 0.9;
    const held = Math.max(read, show);
    if (person) {
      person.avatar.pose({ seconds, read, tap, show, smile, joy, shrug, watch, blink: (seconds / 4.3333 + 0.2) % 1 < 0.03 });
      person.phoneScreen.emissiveIntensity = 0.55 + 1.5 * held + 0.6 * tap;
      person.avatar.phoneAt(phoneGlow.position);
    }
    phoneGlow.visible = Boolean(person);
    phoneGlow.scale.setScalar(0.5 + 0.55 * held + 0.5 * show);
    phoneGlowMaterial.opacity = 0.22 + 0.4 * held + 0.3 * tap;

    // The camera drifts, slowly, and comes back to where it began as the loop does.
    const view = cameraAt(camera.aspect, turn);
    camera.position.set(...view.from);
    camera.lookAt(...view.to);

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
