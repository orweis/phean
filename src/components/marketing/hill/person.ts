import { CapsuleGeometry, CylinderGeometry, Group, LatheGeometry, Mesh, SphereGeometry, TorusGeometry, Vector2, Vector3, type BufferGeometry, type Material } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { bend, meshes, Parts, span, v } from "./rig";

/*
 * You, at the top: a person in the illustrations' clay, with a person's proportions. A head with
 * hair, a neck, shoulders under a knitted sweater, arms that end in hands, trousers and shoes. The
 * face is a few clay shapes: eyes with lids that blink, brows, a nose, cheeks, a jaw, and a mouth
 * that smiles when the call is made. They stand easy, watch the crew climb, read the question on
 * their phone when it arrives, tap, and hold the answer up for the crew to see.
 */

type Slot = "sweater" | "skin" | "hair" | "trousers" | "shoe" | "dark" | "screen" | "white" | "pupil" | "lip" | "blush";
export type PersonMaterials = Record<Slot, Material>;

const PELVIS = 0.9;
const UPPER_ARM = 0.27;
const FOREARM = 0.25;
const THIGH = 0.42;
const SHIN = 0.4;
const ANKLE = 0.075;

/** Index 0 is the person's right (+z), which holds the phone; 1 is their left, on the camera's side. */
const SHOULDER = [v(0, 0.47, 0.215), v(0, 0.47, -0.215)] as const;
const HIP_JOINT = [v(0, -0.06, 0.095), v(0, -0.06, -0.095)] as const;
const FOOT = [v(0.02, ANKLE, 0.11), v(-0.03, ANKLE, -0.12)] as const;

/** The right eye, in the head's space; the left mirrors it. */
const EYE = { x: 0.105, y: 0.146, z: 0.044 };

const HANG = [v(0.17, 0.1, 0.23), v(0.04, -0.04, -0.265)] as const;
const READ = v(0.27, 0.35, 0.08);
const TAP = v(0.26, 0.37, 0.02);
/** Up and out to the side, clear of the head, where the crew can see it. */
const SHOW = v(0.14, 0.86, 0.5);
const HIP_REST = v(0.03, 0.03, -0.27);

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
  blink: boolean;
  /** Where to look, in the world. */
  watch: Vector3;
}

export interface Person {
  root: Group;
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

  // The sweater: narrow at the waist, wide at the shoulders, with a ribbed hem and a rolled collar.
  const profile = [
    [0.001, -0.07],
    [0.165, -0.065],
    [0.2, -0.03],
    [0.197, 0.05],
    [0.182, 0.17],
    [0.19, 0.3],
    [0.208, 0.4],
    [0.205, 0.465],
    [0.165, 0.52],
    [0.09, 0.56],
    [0.06, 0.575],
  ].map(([radius, height]) => new Vector2(radius!, height!));
  const torso = new Parts<Slot>()
    .add("sweater", new LatheGeometry(profile, 28), [0, 0, 0], [0, 0, 0], [0.66, 1, 1])
    .add("sweater", new TorusGeometry(0.188, 0.03, 8, 26), [0, -0.035, 0], [Math.PI / 2, 0, 0], [0.68, 1, 1])
    .add("sweater", new TorusGeometry(0.07, 0.028, 8, 18), [0, 0.575, 0], [Math.PI / 2, 0, 0], [0.9, 1, 1])
    .add("trousers", new SphereGeometry(0.19, 18, 12), [0, -0.09, 0], [0, 0, 0], [0.64, 0.6, 0.98])
    .add("skin", new CylinderGeometry(0.05, 0.055, 0.12, 12), [0, 0.61, 0])
    .build();
  meshes(body, torso, materials);

  const head = new Group();
  head.position.y = 0.65;
  body.add(head);
  const face = new Parts<Slot>()
    .add("skin", new SphereGeometry(0.125, 24, 18), [0, 0.13, 0], [0, 0, 0], [0.97, 1.12, 0.9])
    .add("skin", new SphereGeometry(0.03, 8, 6), [-0.012, 0.115, 0.112], [0, 0, 0], [0.6, 1, 0.5])
    .add("skin", new SphereGeometry(0.03, 8, 6), [-0.012, 0.115, -0.112], [0, 0, 0], [0.6, 1, 0.5])
    .add("skin", new SphereGeometry(0.021, 10, 8), [0.121, 0.1, 0], [0, 0, 0], [1, 1.25, 0.9])
    // A jaw and a chin under the round of the skull, and the round of each cheek.
    .add("skin", new SphereGeometry(0.085, 16, 12), [0.022, 0.058, 0], [0, 0, 0], [1.02, 0.78, 1.02])
    .add("skin", new SphereGeometry(0.03, 10, 8), [0.08, 0.022, 0], [0, 0, 0], [0.9, 0.8, 1.2])
    .add("blush", new SphereGeometry(0.03, 10, 8), [0.092, 0.092, 0.06], [0, 0.5, 0], [0.34, 0.8, 1])
    .add("blush", new SphereGeometry(0.03, 10, 8), [0.092, 0.092, -0.06], [0, -0.5, 0], [0.34, 0.8, 1])
    // The eyes: a white set into the face and a dark pupil on it.
    .add("white", new SphereGeometry(0.025, 12, 10), [EYE.x, EYE.y, EYE.z], [0, 0, 0], [0.5, 1.12, 1])
    .add("white", new SphereGeometry(0.025, 12, 10), [EYE.x, EYE.y, -EYE.z], [0, 0, 0], [0.5, 1.12, 1])
    .add("pupil", new SphereGeometry(0.0145, 10, 8), [EYE.x + 0.0085, EYE.y - 0.002, EYE.z - 0.003], [0, 0, 0], [0.5, 1.1, 1])
    .add("pupil", new SphereGeometry(0.0145, 10, 8), [EYE.x + 0.0085, EYE.y - 0.002, -EYE.z + 0.003], [0, 0, 0], [0.5, 1.1, 1])
    // Hair: a cap swept back from the forehead to the nape, and a fringe across the brow.
    .add("hair", new SphereGeometry(0.136, 24, 14, 0, Math.PI * 2, 0, 1.72), [-0.014, 0.142, 0], [0, 0, 0.5], [0.98, 1.1, 0.93])
    .add("hair", new SphereGeometry(0.075, 14, 10), [0.078, 0.222, 0.012], [0.25, 0, -0.5], [0.75, 0.42, 1.4])
    .add("hair", new SphereGeometry(0.06, 12, 8), [-0.105, 0.09, 0], [0, 0, 0], [0.6, 1, 1.35])
    .build();
  meshes(head, face, materials);
  // The lids: a cap over each eye that turns down across it to blink. Both turn about the line through the eyes.
  const lidGeometry = new Parts<"skin">()
    .add("skin", new SphereGeometry(0.0285, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0, EYE.z], [0, 0, 0], [0.62, 1.12, 1.04])
    .add("skin", new SphereGeometry(0.0285, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0, -EYE.z], [0, 0, 0], [0.62, 1.12, 1.04])
    .build()
    .get("skin")!;
  const lids = new Mesh(lidGeometry, materials.skin);
  lids.position.set(EYE.x, EYE.y, 0);
  const browGeometry = new Parts<"hair">()
    .add("hair", new CapsuleGeometry(0.0065, 0.036, 3, 6), [0, 0, EYE.z + 0.002], [Math.PI / 2 - 0.16, 0, 0.1])
    .add("hair", new CapsuleGeometry(0.0065, 0.036, 3, 6), [0, 0, -EYE.z - 0.002], [Math.PI / 2 + 0.16, 0, 0.1])
    .build()
    .get("hair")!;
  const brows = new Mesh(browGeometry, materials.hair);
  // The mouth: the lower arc of a ring, flat when the face is at rest and deep when it smiles.
  const mouthGeometry = new Parts<"lip">()
    .add("lip", new TorusGeometry(0.03, 0.0062, 6, 14, Math.PI * 0.76), [0, 0, 0], [0, Math.PI / 2, Math.PI * 1.12])
    .build()
    .get("lip")!;
  const mouth = new Mesh(mouthGeometry, materials.lip);
  head.add(lids, brows, mouth);
  head.scale.setScalar(1.08);

  const sleeveUpper = new CapsuleGeometry(0.058, UPPER_ARM - 0.02, 4, 10);
  // The forearm ends in a ribbed cuff.
  const sleeveLower = new Parts<"sweater">()
    .add("sweater", new CapsuleGeometry(0.05, FOREARM - 0.03, 4, 10))
    .add("sweater", new TorusGeometry(0.046, 0.02, 6, 14), [0, FOREARM / 2 - 0.01, 0], [Math.PI / 2, 0, 0])
    .build()
    .get("sweater")!;
  // A hand: a palm with a thumb, modelled past the wrist along +Y.
  const handGeometry = new Parts<"skin">()
    .add("skin", new SphereGeometry(0.047, 12, 10), [0, 0.045, 0], [0, 0, 0], [0.62, 1.3, 1])
    .add("skin", new SphereGeometry(0.02, 8, 6), [0.012, 0.03, 0.045], [0, 0, 0], [1, 1.5, 1])
    .build()
    .get("skin")!;
  const thighGeometry = new CapsuleGeometry(0.082, THIGH - 0.04, 4, 10);
  const shinGeometry = new CapsuleGeometry(0.068, SHIN - 0.02, 4, 10);
  const shoeGeometry = new Parts<"shoe">()
    .add("shoe", new RoundedBoxGeometry(0.27, 0.095, 0.11, 2, 0.045), [0.055, -0.03, 0])
    .build()
    .get("shoe")!;

  const limb = (geometry: BufferGeometry, material: Material) => {
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
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

    // The face: eyes lowered to the phone while reading, a blink now and then, and a smile for the call.
    lids.rotation.z = p.blink ? -1.45 : 0.42 - 0.5 * p.read + 0.12 * p.smile;
    brows.position.set(EYE.x + 0.004, EYE.y + 0.04 - 0.005 * p.read + 0.009 * p.smile, 0);
    mouth.position.set(0.107 - 0.004 * p.smile, 0.064 + 0.02 * p.smile, 0);
    mouth.scale.set(1, 0.3 + 0.75 * p.smile, 0.78 + 0.3 * p.smile);

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
    pose,
    phoneAt(out) {
      return phone.getWorldPosition(out);
    },
    dispose() {
      for (const geometry of [...torso.values(), ...face.values(), ...phoneParts.values(), lidGeometry, browGeometry, mouthGeometry, sleeveUpper, sleeveLower, handGeometry, thighGeometry, shinGeometry, shoeGeometry]) geometry.dispose();
    },
  };
}
