import {
  AdditiveBlending,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";

/**
 * The name, in clay: three agents push the ember boulder up a violet hill at dusk, hold at the top
 * while the person there makes the call, and start again on the next one. Drawn to match the site's
 * illustrations (soft matte figures, a glowing stone, haze), with every colour read from the theme.
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
}

export interface HillScene {
  setPalette(palette: HillPalette): void;
  /** Draws the loop at `progress` (0..1); `seconds` drives the walk cycle and the idle sway. */
  render(progress: number, seconds: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/* ---------------------------------------------------------------------------------------------- */
/* The hill: a long rise from the left to a crest on the right, its profile one smooth function.   */

const FOOT = -5.6;
const CREST = 4.4;
const HEIGHT = 3.4;

/** Height of the near hill at x (the path the crew climbs runs along z = 0). */
function hillY(x: number): number {
  const t = Math.min(1, Math.max(0, (x - (FOOT - 2.5)) / (CREST + 0.6 - (FOOT - 2.5))));
  const eased = t * t * (3 - 2 * t);
  const lift = 0.55 * Math.exp(-(((x - (CREST + 1.4)) / 2.2) ** 2));
  return HEIGHT * eased + lift - 1.6;
}

function hillSlope(x: number): number {
  const h = 0.01;
  return (hillY(x + h) - hillY(x - h)) / (2 * h);
}

/** The near hill's surface: the profile, rolling gently down towards the camera and faster away from it. */
function hillSurface(x: number, z: number): number {
  return hillY(x) - (z > 0 ? 0.011 : 0.03) * z * z;
}

/* ---------------------------------------------------------------------------------------------- */

const BOULDER_R = 0.62;
/** Where along the path the boulder starts and stops, as x. */
const START_X = FOOT + 0.4;
const TOP_X = CREST - 0.35;
/** How far behind the boulder each agent pushes, along x. */
const CREW_OFFSETS = [1.0, 1.72, 2.42];

function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** 0 until `a`, 1 after `b`, smooth between. */
function band(p: number, a: number, b: number): number {
  return smooth((p - a) / (b - a));
}

/** The climb, 0 at the foot to 1 at the top, with the slip Sisyphus knows: it rolls back a little and is caught. */
function climb(p: number): number {
  const up = p / 0.52;
  const eased = up <= 0 ? 0 : up >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * up);
  const slip = Math.sin(Math.PI * Math.min(1, Math.max(0, (up - 0.5) / 0.16)));
  return eased - 0.045 * slip * (up < 1 ? 1 : 0);
}

/* ---------------------------------------------------------------------------------------------- */

function lumpyBoulder(): SphereGeometry {
  // Indexed, so the dents shade smoothly: a sphere's seam shares positions, and the dents follow position alone.
  const geometry = new SphereGeometry(BOULDER_R, 64, 40);
  const position = geometry.getAttribute("position");
  const v = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    v.fromBufferAttribute(position, i);
    const n = v.clone().normalize();
    // A few soft dents, fixed, so the stone reads as hand-shaped clay rather than a ball.
    const dent = 0.022 * Math.sin(n.x * 4.1 + n.y * 2.3) + 0.018 * Math.sin(n.y * 5.3 - n.z * 3.1) + 0.012 * Math.sin(n.z * 7.3 + n.x * 1.7);
    v.copy(n).multiplyScalar(BOULDER_R * (1 + dent));
    position.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** A soft round glow, for the halo behind the boulder and the phone. */
function glowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
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

interface Agent {
  root: Group;
  body: Group;
  legs: [Mesh, Mesh];
  material: MeshStandardMaterial;
}

/** The illustrations' agent: a soft pear of a body, a round head resting on it, stubby arms, little feet. */
const BODY_PROFILE = [
  [0, 0],
  [0.24, 0.02],
  [0.36, 0.12],
  [0.4, 0.28],
  [0.37, 0.46],
  [0.29, 0.66],
  [0.17, 0.82],
  [0.06, 0.9],
  [0, 0.92],
].map(([radius, height]) => new Vector2(radius!, height!));

function makeAgent(material: MeshStandardMaterial, scale: number): Agent {
  const root = new Group();
  const body = new Group();
  root.add(body);
  const torso = new Mesh(new LatheGeometry(BODY_PROFILE, 40), material);
  torso.position.y = 0.06;
  torso.scale.set(1, 1, 0.9);
  const head = new Mesh(new SphereGeometry(0.25, 32, 24), material);
  head.position.set(0.05, 1.08, 0);
  const armGeometry = new CapsuleGeometry(0.085, 0.22, 6, 12);
  const armNear = new Mesh(armGeometry, material);
  armNear.position.set(0.38, 0.6, 0.2);
  armNear.rotation.z = -1.35;
  const armFar = armNear.clone();
  armFar.position.set(0.38, 0.66, -0.2);
  const footGeometry = new SphereGeometry(0.1, 16, 12);
  footGeometry.scale(1.4, 0.6, 1);
  const footNear = new Mesh(footGeometry, material);
  footNear.position.set(0.06, 0.05, 0.16);
  const footFar = new Mesh(footGeometry, material);
  footFar.position.set(0.06, 0.05, -0.16);
  for (const mesh of [torso, head, armNear, armFar, footNear, footFar]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    body.add(mesh);
  }
  root.scale.setScalar(scale);
  return { root, body, legs: [footNear, footFar], material };
}

/* ---------------------------------------------------------------------------------------------- */

export function createHillScene(canvas: HTMLCanvasElement, palette: HillPalette): HillScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  scene.fog = new Fog(0x000000, 14, 34);

  const camera = new PerspectiveCamera(26, 15 / 8, 0.1, 80);
  const lookAt = new Vector3(0.4, 1.75, 0);

  const probeCanvas = document.createElement("canvas");
  probeCanvas.width = probeCanvas.height = 1;
  const probe = probeCanvas.getContext("2d", { willReadFrequently: true })!;

  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  /* Lights: a low warm sun behind the crest, a cool sky fill, and the boulder's own glow. */
  const hemisphere = new HemisphereLight(0xffffff, 0x000000, 0.9);
  scene.add(hemisphere);
  const sun = new DirectionalLight(0xffffff, 1.5);
  sun.position.set(-4, 10, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -9;
  sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 6;
  sun.shadow.camera.bottom = -6;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  sun.shadow.radius = 6;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  // The low sun behind the crest: a warm edge on everything that faces away from the camera.
  const rim = new DirectionalLight(0xffffff, 2.2);
  rim.position.set(9, 3.5, -7);
  scene.add(rim);
  const ember = new PointLight(0xffffff, 6, 5.5, 1.6);
  scene.add(ember);

  /* The near hill. */
  const hillGeometry = keep(new PlaneGeometry(44, 30, 176, 60));
  hillGeometry.rotateX(-Math.PI / 2);
  const hillPositions = hillGeometry.getAttribute("position");
  for (let i = 0; i < hillPositions.count; i += 1) {
    const x = hillPositions.getX(i);
    const z = hillPositions.getZ(i);
    hillPositions.setY(i, hillSurface(x, z));
  }
  hillGeometry.computeVertexNormals();
  hillGeometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(hillPositions.count * 3), 3));
  const hillMaterial = keep(new MeshStandardMaterial({ roughness: 0.95, metalness: 0, vertexColors: true }));
  const hill = new Mesh(hillGeometry, hillMaterial);
  hill.receiveShadow = true;
  scene.add(hill);

  /* Far hills, lower and lighter in the haze. */
  const farMaterials: MeshStandardMaterial[] = [];
  const farHills: [number, number, number, number, number][] = [
    [-10, -4.2, -8, 9, 4.9],
    [1, -4.8, -12, 12, 5.4],
    [13, -4.4, -10, 8, 5.2],
    [-3, -5.6, -17, 16, 6.4],
  ];
  for (const [x, y, z, width, height] of farHills) {
    const material = keep(new MeshStandardMaterial({ roughness: 1 }));
    farMaterials.push(material);
    const geometry = keep(new SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2));
    const mesh = new Mesh(geometry, material);
    mesh.scale.set(width, height, 3);
    mesh.position.set(x, y, z);
    scene.add(mesh);
  }

  /* The boulder, and the next one waiting at the foot. */
  const boulderGeometry = keep(lumpyBoulder());
  const boulderMaterial = keep(new MeshStandardMaterial({ roughness: 0.6, metalness: 0, transparent: true }));
  const boulder = new Mesh(boulderGeometry, boulderMaterial);
  boulder.castShadow = true;
  scene.add(boulder);
  const nextMaterial = keep(new MeshStandardMaterial({ roughness: 0.6, metalness: 0, transparent: true }));
  const nextBoulder = new Mesh(boulderGeometry, nextMaterial);
  nextBoulder.castShadow = true;
  scene.add(nextBoulder);

  const glow = keep(glowTexture());
  const haloMaterial = keep(new SpriteMaterial({ map: glow, blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  const halo = new Sprite(haloMaterial);
  halo.scale.setScalar(3.6);
  scene.add(halo);

  // The warm light of what waits at the top, low in the sky behind the crest.
  const horizonMaterial = keep(new SpriteMaterial({ map: glow, blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.32 }));
  const horizon = new Sprite(horizonMaterial);
  horizon.position.set(CREST + 1.5, hillY(CREST) + 0.6, -16);
  horizon.scale.set(30, 16, 1);
  scene.add(horizon);

  /* The crew. */
  const agentMaterials = [0, 1, 2].map(() => keep(new MeshStandardMaterial({ roughness: 0.78, metalness: 0, transparent: true })));
  const crew = agentMaterials.map((material, index) => makeAgent(material, 0.92 - index * 0.05));
  for (const agent of crew) scene.add(agent.root);

  /* You, at the top, with the phone where the call is made. */
  const personMaterial = keep(new MeshStandardMaterial({ roughness: 0.85 }));
  const person = new Group();
  const personBody = new Mesh(keep(new CapsuleGeometry(0.34, 0.9, 8, 20)), personMaterial);
  personBody.position.y = 0.8;
  const personHead = new Mesh(keep(new SphereGeometry(0.27, 28, 20)), personMaterial);
  personHead.position.y = 1.68;
  const phoneMaterial = keep(new MeshStandardMaterial({ roughness: 0.4 }));
  const phone = new Mesh(keep(new CapsuleGeometry(0.06, 0.12, 4, 8)), phoneMaterial);
  phone.position.set(-0.34, 1.2, 0.22);
  phone.rotation.z = 0.4;
  for (const mesh of [personBody, personHead]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  person.add(personBody, personHead, phone);
  const personX = CREST + 1.05;
  person.position.set(personX, hillSurface(personX, -0.5), -0.5);
  person.scale.setScalar(0.8);
  scene.add(person);
  const phoneGlowMaterial = keep(new SpriteMaterial({ map: glow, blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  const phoneGlow = new Sprite(phoneGlowMaterial);
  phoneGlow.scale.setScalar(0.7);
  scene.add(phoneGlow);

  /* A few stars, high in the band. */
  const starPositions: number[] = [];
  for (let i = 0; i < 70; i += 1) {
    const a = Math.sin(i * 12.9898) * 43758.5453;
    const b = Math.sin(i * 78.233) * 12345.678;
    starPositions.push(((a - Math.floor(a)) - 0.5) * 46, 3.2 + (b - Math.floor(b)) * 7, -22);
  }
  const starGeometry = keep(new BufferGeometry());
  starGeometry.setAttribute("position", new Float32BufferAttribute(starPositions, 3));
  const starMaterial = keep(new PointsMaterial({ size: 0.09, transparent: true, opacity: 0.7, fog: false, depthWrite: false }));
  scene.add(new Points(starGeometry, starMaterial));

  /* ---------------------------------------------------------------------------------------------- */

  let signal = new Color();

  function setPalette(next: HillPalette) {
    const c = (value: string) => cssColor(value, probe);
    const dusk = c(next.dusk);
    const dusk2 = c(next.dusk2);
    const hillColor = c(next.hill);
    const ink = c(next.ink);
    const muted = c(next.muted);
    signal = c(next.signal);
    const shade = c(next.signalShade);
    const accent = c(next.accent);

    // The haze is the band's lower sky, so far hills fade into the section's own gradient.
    (scene.fog as Fog).color.copy(dusk2);
    hemisphere.color.copy(ink).lerp(accent, 0.35);
    hemisphere.groundColor.copy(dusk).lerp(hillColor, 0.4);
    sun.color.copy(ink).lerp(accent, 0.25);
    rim.color.copy(signal).lerp(ink, 0.2);
    ember.color.copy(signal);

    // The hill darkens down its face and warms towards the crest, as the illustrations light it.
    const low = hillColor.clone().lerp(dusk, 0.55);
    const high = hillColor.clone().lerp(ink, 0.12);
    const warm = high.clone().lerp(signal, 0.22);
    const colors = hillGeometry.getAttribute("color");
    const vertex = new Color();
    for (let i = 0; i < colors.count; i += 1) {
      const x = hillPositions.getX(i);
      const y = hillPositions.getY(i);
      const z = hillPositions.getZ(i);
      const height = smooth((y + 2.2) / 4.2);
      vertex.copy(low).lerp(high, height);
      const nearCrest = Math.exp(-(((x - CREST) / 3.2) ** 2)) * Math.exp(-((z / 4) ** 2));
      vertex.lerp(warm, 0.6 * nearCrest);
      colors.setXYZ(i, vertex.r, vertex.g, vertex.b);
    }
    colors.needsUpdate = true;
    farMaterials.forEach((material, index) => material.color.copy(hillColor).lerp(dusk2, 0.45 + index * 0.12));
    horizonMaterial.color.copy(signal).lerp(accent, 0.35);

    for (const material of [boulderMaterial, nextMaterial]) {
      material.color.copy(signal).lerp(shade, 0.25);
      material.emissive.copy(signal);
    }
    haloMaterial.color.copy(signal);
    // The crew is the illustrations' lavender clay: the brand, lifted towards the light.
    agentMaterials.forEach((material, index) => material.color.copy(accent).lerp(dusk, 0.04 + index * 0.07));
    personMaterial.color.copy(ink).lerp(signal, 0.08);
    personMaterial.emissive.copy(ink);
    personMaterial.emissiveIntensity = 0.3;
    phoneMaterial.color.copy(signal);
    phoneMaterial.emissive.copy(signal);
    phoneGlowMaterial.color.copy(signal);
    starMaterial.color.copy(ink).lerp(muted, 0.3);
  }

  function surfacePoint(x: number, lift: number, out: Vector3): Vector3 {
    const slope = hillSlope(x);
    const normal = new Vector3(-slope, 1, 0).normalize();
    return out.set(x, hillY(x), 0).addScaledVector(normal, lift);
  }

  const target = new Vector3();
  function render(progress: number, seconds: number) {
    const p = ((progress % 1) + 1) % 1;
    const along = climb(p);
    const x = START_X + (TOP_X - START_X) * along;

    // The boulder rolls as far as it climbs: its turn is the arc length over its radius.
    surfacePoint(x, BOULDER_R * 0.97, boulder.position);
    boulder.rotation.z = -((x - START_X) * 1.08) / BOULDER_R;
    const handOver = band(p, 0.86, 0.95);
    boulderMaterial.opacity = 1 - handOver;
    boulder.visible = boulderMaterial.opacity > 0.01;

    nextMaterial.opacity = p > 0.5 ? band(p, 0.84, 0.95) : 0;
    nextBoulder.visible = nextMaterial.opacity > 0.01;
    surfacePoint(START_X, BOULDER_R * 0.97, nextBoulder.position);

    // At the top, the call is made: the stone brightens while the card shows the pick.
    const done = band(p, 0.67, 0.72) * (1 - band(p, 0.84, 0.9));
    const pulse = 0.5 + 0.5 * Math.sin(seconds * 2.2);
    boulderMaterial.emissiveIntensity = 0.55 + 0.35 * done + 0.06 * pulse;
    nextMaterial.emissiveIntensity = 0.55;
    const active = boulder.visible ? boulder : nextBoulder;
    halo.position.copy(active.position).add(new Vector3(0, 0, -0.3));
    halo.scale.setScalar(3.2 + 1.2 * done + 0.15 * pulse);
    haloMaterial.opacity = 0.42 + 0.25 * done;
    ember.position.copy(active.position).add(new Vector3(-0.2, 0.5, 0.9));
    ember.intensity = 5 + 3 * done;

    // The crew climbs with it, fades over the crest once the call is made, and walks back in at the foot.
    const climbing = p < 0.52 ? 1 : 0;
    const crewOpacity = p < 0.5 ? band(p, -0.06, 0.04) : 1 - band(p, 0.82, 0.9);
    const crewX = p >= 0.9 ? START_X : x;
    const stride = seconds * 7.5;
    crew.forEach((agent, index) => {
      const ax = crewX - CREW_OFFSETS[index]!;
      surfacePoint(ax, 0, agent.root.position);
      agent.root.position.z = 0.18 * (index - 1);
      const slope = Math.atan(hillSlope(ax));
      agent.root.rotation.z = slope;
      // Leaning into the push, waddling as they go: a side-to-side rock and a bob, the feet stepping under them.
      const phase = stride + index * 1.9;
      agent.body.rotation.z = -0.3 * climbing - 0.06;
      agent.body.rotation.x = climbing ? 0.09 * Math.sin(phase) : 0.03 * Math.sin(seconds * 1.6 + index);
      agent.body.position.y = climbing ? 0.04 * Math.abs(Math.sin(phase)) : 0.012 * Math.sin(seconds * 1.6 + index);
      const step = climbing ? 0.09 * Math.sin(phase) : 0;
      agent.legs[0].position.x = 0.06 + step;
      agent.legs[1].position.x = 0.06 - step;
      agent.material.opacity = Math.max(0, Math.min(1, crewOpacity));
      agent.root.visible = agent.material.opacity > 0.01;
    });

    // The person sways a little; the phone glows when the card is up.
    person.rotation.z = 0.025 * Math.sin(seconds * 0.9);
    const card = band(p, 0.52, 0.57) * (1 - band(p, 0.84, 0.9));
    phoneMaterial.emissiveIntensity = 0.4 + 1.4 * card;
    phone.getWorldPosition(target);
    phoneGlow.position.copy(target);
    phoneGlowMaterial.opacity = 0.15 + 0.6 * card;

    renderer.render(scene, camera);
  }

  function resize(width: number, height: number) {
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Frame the hill by its width: the slope from the foot to the person at the top always fits.
    const span = 15.5;
    const horizontal = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
    const distance = Math.max(13, span / 2 / Math.tan(horizontal / 2));
    camera.position.set(lookAt.x - 0.4, lookAt.y + distance * 0.06, distance);
    camera.lookAt(lookAt);
    camera.updateProjectionMatrix();
  }

  setPalette(palette);

  return {
    setPalette,
    render,
    resize,
    dispose() {
      for (const item of disposables) item.dispose();
      for (const agent of crew) {
        agent.root.traverse((child) => {
          if (child instanceof Mesh) child.geometry.dispose();
        });
      }
      for (const child of [personBody, personHead]) (child.material as Material).dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
