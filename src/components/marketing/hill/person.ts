import { CapsuleGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, Group, LatheGeometry, Mesh, SphereGeometry, TorusGeometry, Vector2, Vector3, type BufferGeometry, type Material } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { bend, meshes, Parts, span, v } from "./rig";

/*
 * You, at the top, drawn as an anime character: a large head on a slim body, a soft face that
 * narrows to a small chin, big eyes with a clear iris and two catch-lights under a dark lash line,
 * the smallest of noses, a mouth that opens into a smile, and hair in chunky locks: a fringe, a lock
 * before each ear, spikes swept back and one stray strand on top. A knitted sweater, trousers and
 * shoes. The scene shades it in flat steps with a dark outline, as cel animation does. They stand
 * easy, watch the crew climb, read the question on their phone when it arrives, tap, shut their eyes
 * in a smile, and hold the answer up for the crew to see.
 */

type Slot = "sweater" | "skin" | "hair" | "trousers" | "shoe" | "dark" | "screen" | "white" | "iris" | "pupil" | "shine" | "lip" | "blush";
export type PersonMaterials = Record<Slot, Material>;

const PELVIS = 0.92;
const UPPER_ARM = 0.26;
const FOREARM = 0.25;
const THIGH = 0.44;
const SHIN = 0.42;
const ANKLE = 0.075;

/** Index 0 is the person's right (+z), which holds the phone; 1 is their left, on the camera's side. */
const SHOULDER = [v(0, 0.45, 0.185), v(0, 0.45, -0.185)] as const;
const HIP_JOINT = [v(0, -0.05, 0.075), v(0, -0.05, -0.075)] as const;
const FOOT = [v(0.02, ANKLE, 0.09), v(-0.03, ANKLE, -0.1)] as const;

/** The right eye's middle on the face, in the head's space (its origin is the chin), and how far the face has turned from straight ahead there; the left mirrors it. */
const EYE = { x: 0.1, y: 0.152, z: 0.056, turn: 0.42 };

const HANG = [v(0.15, 0.08, 0.2), v(0.03, -0.05, -0.215)] as const;
const READ = v(0.24, 0.33, 0.07);
const TAP = v(0.23, 0.35, 0.02);
/** Up and out to the side, clear of the head, where the crew can see it. */
const SHOW = v(0.13, 0.83, 0.44);
const HIP_REST = v(0.03, 0.02, -0.22);

export interface PersonPose {
  seconds: number;
  /** 1 reading the question on the phone. */
  read: number;
  /** 1 as the free hand taps the answer. */
  tap: number;
  /** 1 holding the answer up. */
  show: number;
  /** 1 pleased with the call. */
  smile: number;
  /** 1 with eyes shut in delight. */
  joy: number;
  blink: boolean;
  /** Where to look, in the world. */
  watch: Vector3;
}

export interface Person {
  root: Group;
  /** The meshes that take an ink outline: the body, not the features drawn on the face. */
  inked: Mesh[];
  pose(pose: PersonPose): void;
  /** The phone's screen, in the world. */
  phoneAt(out: Vector3): Vector3;
  dispose(): void;
}

const shoulderAt = new Vector3();
const hipAt = new Vector3();
const joint = new Vector3();
const end = new Vector3();
const target = new Vector3();
const pole = new Vector3();
const local = new Vector3();

export function makePerson(materials: PersonMaterials): Person {
  const root = new Group();
  const body = new Group();
  root.add(body);
  const inked: Mesh[] = [];

  // The sweater: slim, with a ribbed hem and a rolled collar.
  const profile = [
    [0.001, -0.07],
    [0.15, -0.065],
    [0.176, -0.03],
    [0.17, 0.05],
    [0.156, 0.17],
    [0.166, 0.3],
    [0.182, 0.39],
    [0.178, 0.44],
    [0.13, 0.49],
    [0.07, 0.525],
    [0.045, 0.54],
  ].map(([radius, height]) => new Vector2(radius!, height!));
  const torso = new Parts<Slot>()
    .add("sweater", new LatheGeometry(profile, 28), [0, 0, 0], [0, 0, 0], [0.7, 1, 1])
    .add("sweater", new TorusGeometry(0.166, 0.026, 8, 26), [0, -0.035, 0], [Math.PI / 2, 0, 0], [0.72, 1, 1])
    .add("sweater", new TorusGeometry(0.052, 0.024, 8, 18), [0, 0.545, 0], [Math.PI / 2, 0, 0], [0.92, 1, 1])
    .add("trousers", new SphereGeometry(0.16, 18, 12), [0, -0.09, 0], [0, 0, 0], [0.66, 0.6, 0.98])
    .add("skin", new CylinderGeometry(0.036, 0.04, 0.1, 12), [0, 0.58, 0])
    .build();
  inked.push(...meshes(body, torso, materials));

  const head = new Group();
  head.position.y = 0.6;
  head.scale.setScalar(1.1);
  body.add(head);
  // The head, turned on a lathe from the chin up: a small chin, full cheeks, a wide round skull.
  const skull = [
    [0.001, 0],
    [0.03, 0.006],
    [0.064, 0.036],
    [0.093, 0.08],
    [0.115, 0.125],
    [0.13, 0.175],
    [0.135, 0.22],
    [0.128, 0.265],
    [0.104, 0.305],
    [0.06, 0.332],
    [0.001, 0.342],
  ].map(([radius, height]) => new Vector2(radius!, height!));
  /** How far forward the face is at a height and a distance to the side. */
  const faceAt = (y: number, z: number) => {
    const at = skull.findIndex((point) => point.y >= y);
    const [low, high] = [skull[Math.max(0, at - 1)]!, skull[Math.max(1, at)]!];
    const radius = low.x + ((high.x - low.x) * (y - low.y)) / (high.y - low.y || 1);
    return 0.96 * Math.sqrt(Math.max(0, radius * radius - (z / 0.92) ** 2));
  };
  const face = new Parts<Slot>()
    .add("skin", new LatheGeometry(skull, 28), [0, 0, 0], [0, 0, 0], [0.96, 1, 0.92])
    .add("skin", new SphereGeometry(0.03, 8, 6), [-0.012, 0.15, 0.118], [0, 0, 0], [0.5, 1, 0.4])
    .add("skin", new SphereGeometry(0.03, 8, 6), [-0.012, 0.15, -0.118], [0, 0, 0], [0.5, 1, 0.4])
    // The nose: hardly more than a point.
    .add("skin", new SphereGeometry(0.01, 8, 6), [faceAt(0.108, 0) + 0.003, 0.108, 0], [0, 0, 0], [1, 0.8, 0.8]);
  // Hair, in locks. A cap over the skull first.
  face.add("hair", new SphereGeometry(0.152, 22, 14, 0, Math.PI * 2, 0, 1.7), [-0.008, 0.207, 0], [0, 0, 0.2], [1, 1.02, 0.97]);
  // The fringe: five locks falling over the brow, the middle ones longest.
  for (let lock = -2; lock <= 2; lock += 1) {
    const z = lock * 0.046;
    const length = 0.135 - 0.012 * Math.abs(lock) + (lock === 1 ? 0.014 : 0);
    face.add("hair", new ConeGeometry(0.05, length, 7), [faceAt(0.25, z) + 0.006, 0.29 - length / 2, z], [Math.PI + lock * 0.14, 0, -0.2 - 0.03 * Math.abs(lock)], [0.42, 1, 1]);
  }
  for (const side of [1, -1]) {
    // A lock before each ear, down to the jaw; three spikes swept back behind it; and the crown's.
    face.add("hair", new ConeGeometry(0.03, 0.2, 7), [0.03, 0.165, side * 0.122], [Math.PI - side * 0.1, 0, -0.08], [0.7, 1, 0.5]);
    face.add("hair", new ConeGeometry(0.05, 0.17, 7), [-0.105, 0.12, side * 0.075], [side * 0.35, 0, 2.5], [1, 1, 0.8]);
    face.add("hair", new ConeGeometry(0.05, 0.15, 7), [-0.085, 0.3, side * 0.06], [side * 0.5, 0, 1.15], [1, 1, 0.8]);
  }
  face.add("hair", new ConeGeometry(0.055, 0.19, 7), [-0.125, 0.15, 0], [0, 0, 2.35]);
  face.add("hair", new ConeGeometry(0.05, 0.16, 7), [-0.12, 0.25, 0], [0, 0, 1.75]);
  face.add("hair", new ConeGeometry(0.045, 0.13, 7), [-0.02, 0.36, 0.02], [0.2, 0, 0.75]);
  // One strand that will not lie down.
  face.add("hair", new ConeGeometry(0.014, 0.1, 5), [0.02, 0.385, -0.01], [0, 0, -0.55]);
  const faceParts = face.build();
  inked.push(...meshes(head, faceParts, materials));

  /** A point on the face by an eye, `out` proud of it and `up` above its middle, `over` towards the ear. */
  const byEye = (side: number, out: number, up = 0, over = 0): [number, number, number] => [
    EYE.x + out * Math.cos(EYE.turn) - over * Math.sin(EYE.turn),
    up,
    side * (EYE.z + out * Math.sin(EYE.turn) + over * Math.cos(EYE.turn)),
  ];
  // The eyes: a tall white, a big iris, a pupil, and two catch-lights, both on the side the light comes from.
  const eyeParts = new Parts<Slot>();
  for (const side of [1, -1]) {
    const turned: [number, number, number] = [0, -side * EYE.turn, 0];
    eyeParts
      .add("white", new SphereGeometry(0.034, 16, 12), byEye(side, 0.002), turned, [0.2, 1, 0.74])
      .add("iris", new SphereGeometry(0.026, 14, 10), byEye(side, 0.0065, -0.003, -0.002), turned, [0.2, 1.06, 0.8])
      .add("pupil", new SphereGeometry(0.0125, 10, 8), byEye(side, 0.0105, -0.004, -0.002), turned, [0.2, 1.25, 0.85])
      .add("shine", new SphereGeometry(0.0085, 8, 6), [...byEye(side, 0.0135, 0.012, 0)].map((value, axis) => (axis === 2 ? value + 0.008 : value)) as [number, number, number], turned, [0.25, 1, 1])
      .add("shine", new SphereGeometry(0.0045, 6, 5), [...byEye(side, 0.0135, -0.014, 0)].map((value, axis) => (axis === 2 ? value - 0.007 : value)) as [number, number, number], turned, [0.25, 1, 1]);
  }
  const eyeGeometries = eyeParts.build();
  const eyes = new Group();
  eyes.position.y = EYE.y;
  for (const mesh of meshes(eyes, eyeGeometries, materials)) mesh.castShadow = mesh.receiveShadow = false;
  // The lash line over each eye: all that shows of it when it shuts. And the brows.
  const lines = new Parts<"pupil" | "hair" | "blush">();
  for (const side of [1, -1]) {
    lines
      .add("pupil", new TorusGeometry(0.031, 0.0055, 5, 12, Math.PI * 0.78), byEye(side, 0.006), [0, Math.PI / 2 - side * EYE.turn, Math.PI * 0.11], [0.76, 1, 1])
      .add("hair", new CapsuleGeometry(0.0045, 0.04, 3, 6), byEye(side, 0.007, 0.053, 0.002), [Math.PI / 2 - side * 0.14, 0, side * EYE.turn])
      .add("blush", new SphereGeometry(0.024, 10, 8), byEye(side, 0.001, -0.05, 0.012), [0, -side * EYE.turn, 0], [0.12, 0.5, 1]);
  }
  const lineGeometries = lines.build();
  const lashes = new Mesh(lineGeometries.get("pupil")!, materials.pupil);
  const brows = new Mesh(lineGeometries.get("hair")!, materials.hair);
  const blush = new Mesh(lineGeometries.get("blush")!, materials.blush);
  blush.position.y = EYE.y;
  // The mouth: the lower half of a disc, a line at rest and open when it smiles.
  const mouthGeometry = new CircleGeometry(0.024, 14, Math.PI, Math.PI);
  mouthGeometry.rotateY(Math.PI / 2);
  const mouth = new Mesh(mouthGeometry, materials.lip);
  mouth.position.set(faceAt(0.07, 0) + 0.004, 0.078, 0);
  head.add(eyes, lashes, brows, blush, mouth);

  const sleeveUpper = new CapsuleGeometry(0.047, UPPER_ARM - 0.02, 4, 10);
  const sleeveLower = new CapsuleGeometry(0.042, FOREARM - 0.03, 4, 10);
  // A hand: a palm with a thumb, modelled past the wrist along +Y.
  const handGeometry = new Parts<"skin">()
    .add("skin", new SphereGeometry(0.038, 12, 10), [0, 0.038, 0], [0, 0, 0], [0.62, 1.3, 1])
    .add("skin", new SphereGeometry(0.016, 8, 6), [0.01, 0.026, 0.036], [0, 0, 0], [1, 1.5, 1])
    .build()
    .get("skin")!;
  const thighGeometry = new CapsuleGeometry(0.072, THIGH - 0.04, 4, 10);
  const shinGeometry = new CapsuleGeometry(0.058, SHIN - 0.02, 4, 10);
  const shoeGeometry = new Parts<"shoe">()
    .add("shoe", new RoundedBoxGeometry(0.22, 0.085, 0.092, 2, 0.04), [0.045, -0.03, 0])
    .build()
    .get("shoe")!;

  const limb = (geometry: BufferGeometry, material: Material) => {
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    inked.push(mesh);
    return mesh;
  };
  const arms = [0, 1].map(() => ({ upper: limb(sleeveUpper, materials.sweater), fore: limb(sleeveLower, materials.sweater), hand: limb(handGeometry, materials.skin) }));
  const legs = [0, 1].map(() => ({ thigh: limb(thighGeometry, materials.trousers), shin: limb(shinGeometry, materials.trousers), shoe: limb(shoeGeometry, materials.shoe) }));

  // The phone, in the right hand: a dark slab with a lit screen on its +x face.
  const phone = new Group();
  const phoneParts = new Parts<Slot>()
    .add("dark", new RoundedBoxGeometry(0.016, 0.17, 0.09, 1, 0.006))
    .add("screen", new RoundedBoxGeometry(0.006, 0.152, 0.076, 1, 0.002), [0.008, 0, 0])
    .build();
  meshes(phone, phoneParts, materials);
  root.add(phone);

  function pose(p: PersonPose) {
    const breath = Math.sin(p.seconds * 1.933);
    const shift = Math.sin(p.seconds * 0.4833);
    const held = Math.max(p.read, p.show);

    // Standing easy: the weight moves from one foot to the other, the chest rises and falls.
    body.position.set(0.004 * breath, PELVIS - 0.004 * Math.abs(shift), 0.022 * shift);
    body.rotation.set(-0.025 * shift, 0.05 * shift - 0.12 * p.show, 0.02 - 0.05 * p.read + 0.05 * p.show);
    body.scale.set(1 + 0.012 * breath, 1 + 0.008 * breath, 1);
    body.updateMatrix();

    root.updateMatrixWorld(true);
    root.worldToLocal(local.copy(p.watch));
    const towards = Math.max(-0.75, Math.min(0.75, Math.atan2(-local.z, local.x)));
    head.rotation.set(0.03 * shift, towards * (1 - 0.75 * p.read) + 0.12 * p.read, -0.08 - 0.34 * p.read + 0.14 * p.show + 0.015 * breath);

    // The face: eyes lowered to the phone while reading, a blink now and then, and for the call a smile with the eyes shut.
    const shut = Math.max(p.blink ? 1 : 0, p.joy);
    eyes.scale.y = (1 - 0.94 * shut) * (1 - 0.3 * p.read);
    lashes.position.y = EYE.y - 0.027 * shut * (1 - 0.45 * p.joy) - 0.009 * p.read * (1 - shut);
    brows.position.y = EYE.y + 0.007 * p.smile - 0.006 * p.read;
    mouth.scale.set(1, 0.09 + 0.91 * p.smile, 0.42 + 0.58 * p.smile);

    for (let i = 0; i < 2; i += 1) {
      const sign = i === 0 ? 1 : -1;
      const arm = arms[i]!;
      shoulderAt.copy(SHOULDER[i]!).applyMatrix4(body.matrix);
      target.copy(HANG[i]!);
      if (i === 0) {
        target.lerp(READ, p.read).lerp(SHOW, p.show);
        target.y += 0.012 * breath * (1 - held) + 0.012 * Math.sin(p.seconds * 3.87) * p.show;
      } else {
        target.lerp(HIP_REST, p.show).lerp(TAP, p.tap);
      }
      target.applyMatrix4(body.matrix);
      pole.set(-0.7, -1, sign * (0.45 + 0.5 * (i === 1 ? p.show : 0)));
      bend(shoulderAt, target, UPPER_ARM, FOREARM, pole, joint, end);
      span(arm.upper, shoulderAt, joint);
      span(arm.fore, joint, end);
      arm.hand.position.copy(end);
      arm.hand.quaternion.copy(arm.fore.quaternion);

      const leg = legs[i]!;
      hipAt.copy(HIP_JOINT[i]!).applyMatrix4(body.matrix);
      pole.set(1, 0.1, sign * 0.1);
      bend(hipAt, FOOT[i]!, THIGH, SHIN, pole, joint, end);
      span(leg.thigh, hipAt, joint);
      span(leg.shin, joint, end);
      leg.shoe.position.copy(end);
      leg.shoe.rotation.y = -sign * 0.22;
    }

    // The phone stands in the right hand: its screen to the reader, then turned to the crew.
    const hand = arms[0]!.hand;
    phone.position.copy(hand.position).add(target.set(0.03 + 0.02 * p.show, 0.07 + 0.05 * held, 0.01));
    phone.rotation.set(0, Math.PI * (1 - p.show) + 0.25 * p.show, 0.5 * (1 - held) - 0.25 * p.read + 0.08 * p.show);
  }

  return {
    root,
    inked,
    pose,
    phoneAt(out) {
      return phone.getWorldPosition(out);
    },
    dispose() {
      for (const geometry of [...torso.values(), ...faceParts.values(), ...eyeGeometries.values(), ...lineGeometries.values(), ...phoneParts.values(), mouthGeometry, sleeveUpper, sleeveLower, handGeometry, thighGeometry, shinGeometry, shoeGeometry]) geometry.dispose();
    },
  };
}
