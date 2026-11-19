import { CapsuleGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, Vector3, type BufferGeometry, type Material } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { bend, meshes, Parts, span, v } from "./rig";

/*
 * An agent, as a robot of the illustrations' family: a rounded shell with pressed panels, a head with
 * a dark glass visor and two LED eyes, an antenna with a lit tip, thin struts for upper arms and
 * thighs, chunky forearms ending in mittens, and boots. The kit's geometry is built once and shared
 * by the whole fleet; a bot differs in its size, its antenna and the colour of its trim.
 */

type Slot = "shell" | "dark" | "trim" | "visor" | "eye" | "tip";
export type BotMaterials = Record<Slot, Material>;

const HIP = 0.46;
const NECK = 0.62;
const UPPER_ARM = 0.22;
const FOREARM = 0.25;
const THIGH = 0.2;
const SHIN = 0.2;
const ANKLE = 0.1;
/** One full walk cycle, in the bot's own units of ground covered. */
const CYCLE = 0.64;
const STANCE = 0.6;

const SHOULDER = [v(0.02, 0.42, 0.285), v(0.02, 0.42, -0.285)] as const;
const HIP_JOINT = [v(0, 0.02, 0.12), v(0, 0.02, -0.12)] as const;
/** Where a hand rests on the rear face of the pack, one each side of its trim, and the way that face looks. */
const PACK = [v(-0.315, 0.3, 0.085), v(-0.315, 0.3, -0.085)] as const;
const PACK_FACES = v(-1, 0, 0);
/** From a wrist to the far side of its mitten, in the bot's own units: a wrist held this far off a surface lays the mitten on it. */
export const PALM = 0.118;
/** A bent arm's comfortable reach, shoulder to wrist. */
export const REACH = 0.445;

export interface BotKit {
  torso: Map<Slot, BufferGeometry>;
  head: Map<Slot, BufferGeometry>;
  eyes: BufferGeometry;
  tip: BufferGeometry;
  upperArm: BufferGeometry;
  forearm: BufferGeometry;
  thigh: BufferGeometry;
  shin: BufferGeometry;
  foot: BufferGeometry;
  dispose(): void;
}

export function makeBotKit(): BotKit {
  const torso = new Parts<Slot>()
    .add("shell", new RoundedBoxGeometry(0.44, 0.44, 0.5, 3, 0.14), [0, 0.32, 0])
    .add("dark", new RoundedBoxGeometry(0.3, 0.17, 0.36, 2, 0.07), [0, 0.05, 0])
    .add("dark", new CylinderGeometry(0.075, 0.085, 0.1, 14), [0, 0.58, 0])
    .add("dark", new SphereGeometry(0.07, 12, 8), [0.02, 0.42, 0.27])
    .add("dark", new SphereGeometry(0.07, 12, 8), [0.02, 0.42, -0.27])
    // The pack on its back: where the one behind puts its hands.
    .add("dark", new RoundedBoxGeometry(0.13, 0.27, 0.3, 2, 0.05), [-0.25, 0.33, 0])
    .add("trim", new RoundedBoxGeometry(0.035, 0.05, 0.2, 1, 0.01), [-0.305, 0.4, 0])
    .add("trim", new RoundedBoxGeometry(0.452, 0.085, 0.512, 2, 0.042), [0, 0.2, 0])
    .add("trim", new SphereGeometry(0.105, 14, 10), [0.02, 0.47, 0.3], [0, 0, 0], [1, 0.72, 0.62])
    .add("trim", new SphereGeometry(0.105, 14, 10), [0.02, 0.47, -0.3], [0, 0, 0], [1, 0.72, 0.62])
    // A status light on the chest, and a vent beside it.
    .add("tip", new SphereGeometry(0.032, 10, 8), [0.218, 0.42, 0.11], [0, 0, 0], [0.5, 1, 1])
    .add("dark", new RoundedBoxGeometry(0.02, 0.05, 0.16, 1, 0.008), [0.215, 0.42, -0.08])
    .build();

  const head = new Parts<Slot>()
    .add("shell", new RoundedBoxGeometry(0.44, 0.36, 0.48, 3, 0.13), [0, 0.19, 0])
    // The visor wraps the front of the head, so it shows from the side as well.
    .add("visor", new RoundedBoxGeometry(0.3, 0.19, 0.496, 3, 0.07), [0.086, 0.2, 0])
    .add("trim", new CylinderGeometry(0.085, 0.085, 0.05, 18), [-0.06, 0.19, 0.24], [Math.PI / 2, 0, 0])
    .add("trim", new CylinderGeometry(0.085, 0.085, 0.05, 18), [-0.06, 0.19, -0.24], [Math.PI / 2, 0, 0])
    .add("dark", new CylinderGeometry(0.04, 0.04, 0.062, 12), [-0.06, 0.19, 0.24], [Math.PI / 2, 0, 0])
    .add("dark", new CylinderGeometry(0.04, 0.04, 0.062, 12), [-0.06, 0.19, -0.24], [Math.PI / 2, 0, 0])
    .build();

  // Two LED eyes on the visor, standing a little proud of it so they show in profile.
  const eyes = new Parts<"eye">()
    .add("eye", new SphereGeometry(0.036, 12, 10), [0, 0, 0.095], [0, 0, 0], [0.55, 1.2, 1])
    .add("eye", new SphereGeometry(0.036, 12, 10), [0, 0, -0.095], [0, 0, 0], [0.55, 1.2, 1])
    .build()
    .get("eye")!;

  // The mitten sits at the far end of the forearm, a thumb on its inner side.
  const forearm = new Parts<"shell">()
    .add("shell", new CapsuleGeometry(0.06, FOREARM - 0.04, 4, 10))
    .add("shell", new SphereGeometry(0.086, 14, 10), [0, FOREARM / 2 + 0.04, 0], [0, 0, 0], [1, 1.08, 0.92])
    .add("shell", new SphereGeometry(0.036, 8, 6), [0.06, FOREARM / 2 + 0.02, 0])
    .build()
    .get("shell")!;

  const shin = new Parts<"shell">()
    .add("shell", new CapsuleGeometry(0.066, SHIN - 0.06, 4, 10))
    .build()
    .get("shell")!;

  // The boot, its origin at the ankle.
  const foot = new Parts<"shell">()
    .add("shell", new RoundedBoxGeometry(0.28, 0.12, 0.19, 2, 0.055), [0.05, -0.04, 0])
    .build()
    .get("shell")!;

  const kit: BotKit = {
    torso,
    head,
    eyes,
    tip: new SphereGeometry(0.045, 12, 10),
    upperArm: new CapsuleGeometry(0.04, UPPER_ARM, 3, 8),
    forearm,
    thigh: new CapsuleGeometry(0.048, THIGH, 3, 8),
    shin,
    foot,
    dispose() {
      for (const geometry of [...torso.values(), ...head.values(), eyes, kit.tip, kit.upperArm, forearm, kit.thigh, shin, foot]) geometry.dispose();
    },
  };
  return kit;
}

export interface BotLook {
  scale: number;
  /** The antenna: its height, where it stands on the head (z), and how far it leans back. */
  antenna: number;
  antennaAt: number;
  antennaLean: number;
}

export interface BotPose {
  /** 1 leaning into the push, 0 standing. */
  push: number;
  /** 1 with its arms up, the call made. */
  cheer: number;
  /** 1 walking free, arms swinging. */
  walk: number;
  /** Ground covered the way it faces, in world units: the feet step as far as the bot has come. */
  distance: number;
  seconds: number;
  /** Where the wrists go when it pushes, in the world. */
  hands: readonly [Vector3, Vector3];
  /** The head's turn towards the camera and its tilt up, in radians. */
  headTurn: number;
  headTilt: number;
  blink: boolean;
}

export interface Bot {
  root: Group;
  look: BotLook;
  pose(pose: BotPose): void;
  /** Where a shoulder is in the world, as posed last (0 is the camera's side). */
  shoulder(index: 0 | 1, out: Vector3): Vector3;
  /** The lit tip of its antenna, in the world. */
  tipAt(out: Vector3): Vector3;
  /** A point on the back of its pack, in the world, and which way the pack faces there: where the bot behind lays a hand. */
  back(index: 0 | 1, point: Vector3, facing: Vector3): void;
  dispose(): void;
}

const shoulderAt = new Vector3();
const hipAt = new Vector3();
const joint = new Vector3();
const end = new Vector3();
const target = new Vector3();
const rest = new Vector3();
const pole = new Vector3();

export function makeBot(kit: BotKit, materials: BotMaterials, look: BotLook): Bot {
  const root = new Group();
  root.scale.setScalar(look.scale);
  const body = new Group();
  root.add(body);
  meshes(body, kit.torso, materials);
  const head = new Group();
  head.position.y = NECK;
  body.add(head);
  meshes(head, kit.head, materials);
  const eyes = new Mesh(kit.eyes, materials.eye);
  eyes.position.set(0.236, 0.205, 0);
  head.add(eyes);

  const antenna = new Group();
  antenna.position.set(-0.07, 0.36, look.antennaAt);
  head.add(antenna);
  const stemGeometry = new CylinderGeometry(0.012, 0.016, look.antenna, 6);
  stemGeometry.translate(0, look.antenna / 2, 0);
  const stem = new Mesh(stemGeometry, materials.dark);
  const tip = new Mesh(kit.tip, materials.tip);
  tip.position.y = look.antenna + 0.03;
  antenna.add(stem, tip);

  const limb = (geometry: BufferGeometry, material: Material) => {
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
  const arms = [0, 1].map(() => ({ upper: limb(kit.upperArm, materials.dark), fore: limb(kit.forearm, materials.shell) }));
  const legs = [0, 1].map(() => ({ thigh: limb(kit.thigh, materials.dark), shin: limb(kit.shin, materials.shell), foot: limb(kit.foot, materials.shell) }));
  for (const mesh of [eyes, stem, tip]) mesh.castShadow = false;

  function pose(p: BotPose) {
    const { push, cheer, walk } = p;
    const stride = Math.max(push, walk);
    const walked = p.distance / look.scale / CYCLE;
    const swing = Math.sin(walked * Math.PI * 2);
    const hop = cheer * 0.07 * Math.abs(Math.sin(p.seconds * 7.25 + look.antennaAt * 20));

    body.position.set(0.02 * push, HIP - 0.055 * push + 0.022 * stride * Math.abs(swing) + hop, 0);
    body.rotation.set(0.06 * stride * swing, 0, -0.36 * push - 0.03 + 0.1 * cheer + 0.07 * walk);
    body.updateMatrix();
    head.rotation.set(0, -p.headTurn, p.headTilt + 0.24 * push);
    antenna.rotation.set(0.1 * swing * stride + 0.08 * Math.sin(p.seconds * 2.9 + look.antennaAt * 9), 0, look.antennaLean + 0.32 * push + 0.07 * Math.sin(p.seconds * 3.87 + look.scale * 9));
    eyes.scale.y = p.blink ? 0.12 : 1 - 0.35 * cheer;
    tip.scale.setScalar(1 + 0.18 * Math.sin(p.seconds * 4.83 + look.scale * 30) + 0.5 * cheer);

    root.updateMatrixWorld(true);
    for (let i = 0; i < 2; i += 1) {
      const sign = i === 0 ? 1 : -1;
      const arm = arms[i]!;
      shoulderAt.copy(SHOULDER[i]!).applyMatrix4(body.matrix);
      // Hanging at its side, on the load, or up in the air: the hand goes between the three.
      rest.copy(shoulderAt).add(target.set(0.07 + 0.17 * walk * Math.sin(walked * Math.PI * 2 + i * Math.PI), -0.37 + 0.03 * walk, sign * 0.06));
      root.worldToLocal(target.copy(p.hands[i]!));
      rest.lerp(target, push);
      target.copy(shoulderAt).add(joint.set(0.1 + 0.05 * Math.sin(p.seconds * 7.25 + i), 0.36, sign * 0.16));
      rest.lerp(target, cheer);
      pole.set(-0.5, -1 + 0.6 * cheer, sign * (0.5 + cheer));
      bend(shoulderAt, rest, UPPER_ARM, FOREARM, pole, joint, end);
      span(arm.upper, shoulderAt, joint);
      span(arm.fore, joint, end);

      const leg = legs[i]!;
      hipAt.copy(HIP_JOINT[i]!).applyMatrix4(body.matrix);
      // A foot stays where it lands while the bot passes over it, then swings forward to the next step.
      const cycle = (((walked + i * 0.5) % 1) + 1) % 1;
      const reach = (STANCE * CYCLE) / 2;
      let x = reach * (1 - (2 * cycle) / STANCE);
      let lift = 0;
      if (cycle > STANCE) {
        const t = (cycle - STANCE) / (1 - STANCE);
        x = reach * (2 * t * t * (3 - 2 * t) - 1);
        lift = Math.sin(Math.PI * t);
      }
      target.set(x * stride - 0.2 * push + 0.01 * sign * (1 - stride), ANKLE + 0.1 * lift * stride + hop, sign * 0.125);
      pole.set(1, 0.3, sign * 0.15);
      bend(hipAt, target, THIGH, SHIN, pole, joint, end);
      span(leg.thigh, hipAt, joint);
      span(leg.shin, joint, end);
      leg.foot.position.copy(end);
      leg.foot.rotation.z = -0.45 * lift * stride - 0.12 * push;
    }
  }

  return {
    root,
    look,
    pose,
    shoulder(index, out) {
      return root.localToWorld(out.copy(SHOULDER[index]).applyMatrix4(body.matrix));
    },
    tipAt(out) {
      return tip.getWorldPosition(out);
    },
    back(index, point, facing) {
      root.localToWorld(point.copy(PACK[index]).applyMatrix4(body.matrix));
      facing.copy(PACK_FACES).transformDirection(body.matrix).transformDirection(root.matrixWorld);
    },
    dispose() {
      stemGeometry.dispose();
    },
  };
}
