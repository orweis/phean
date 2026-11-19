import { Euler, Quaternion, Vector3, type Mesh, type Object3D } from "three";

/*
 * You, at the top: an anime character (VRoid's AvatarSample_C, public/marketing/models) posed on
 * its own skeleton. They stand easy, breathe and shift their weight, watch the crew climb, read the
 * question on their phone when it arrives, tap, smile, shut their eyes in delight as the boulder
 * goes, and hold the answer up for the crew to see.
 *
 * A pose is worked out from the rest pose every time, never from the pose before, so a frame is a
 * function of the loop's progress (and the idle clock) alone. tests/hill.test.ts holds it to that.
 */

/** The bones the pose moves, by the names VRoid gives them. Sides are the character's own. */
export const AVATAR_BONES = {
  hips: "J_Bip_C_Hips",
  spine: "J_Bip_C_Spine",
  chest: "J_Bip_C_Chest",
  neck: "J_Bip_C_Neck",
  head: "J_Bip_C_Head",
  rightUpperArm: "J_Bip_R_UpperArm",
  rightLowerArm: "J_Bip_R_LowerArm",
  rightHand: "J_Bip_R_Hand",
  leftUpperArm: "J_Bip_L_UpperArm",
  leftLowerArm: "J_Bip_L_LowerArm",
  leftHand: "J_Bip_L_Hand",
} as const;
export type AvatarBone = keyof typeof AVATAR_BONES;

/** The faces the model can pull, as its morph targets are named (the build keeps these three). */
export type AvatarFace = "smile" | "joy" | "blink";

export interface AvatarRig {
  /** What stands on the hill: its +x is the way the character faces, +z their right, +y up. */
  root: Object3D;
  bones: Record<AvatarBone, Object3D>;
  /** The meshes of the face, whose morph targets are the expressions. */
  faces: Mesh[];
  /** The phone, a child of the scene: it is put in the right hand. */
  phone: Object3D;
}

export interface AvatarPose {
  /** The idle clock. */
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

export interface Avatar {
  pose(pose: AvatarPose): void;
  /** The phone's screen, in the world. */
  phoneAt(out: Vector3): Vector3;
}

const from = new Vector3();
const to = new Vector3();
const want = new Vector3();
const local = new Vector3();
const turn = new Quaternion();
const parent = new Quaternion();
const world = new Quaternion();
const twist = new Quaternion();
const euler = new Euler();

/** A direction given as so much forward, up and to the character's right, in the world. */
function heading(root: Object3D, forward: number, up: number, right: number, out: Vector3): Vector3 {
  return out.set(forward, up, right).applyQuaternion(root.getWorldQuaternion(world)).normalize();
}

/** Turns `bone` so that `child` lies along `direction` (in the world) from it. */
function aim(root: Object3D, bone: Object3D, child: Object3D, direction: Vector3) {
  root.updateMatrixWorld(true);
  bone.getWorldPosition(from);
  child.getWorldPosition(to).sub(from).normalize();
  turn.setFromUnitVectors(to, direction);
  bone.getWorldQuaternion(world);
  bone.parent!.getWorldQuaternion(parent).invert();
  bone.quaternion.copy(parent).multiply(turn).multiply(world);
}

/** Three weighted directions, blended: `b` as `t` comes in, then `c` as `u` does. */
function blend(a: readonly number[], b: readonly number[], t: number, c: readonly number[], u: number): [number, number, number] {
  const mix = (i: number) => (a[i]! + (b[i]! - a[i]!) * t) * (1 - u) + c[i]! * u;
  return [mix(0), mix(1), mix(2)];
}

/** Where the arms point, as forward, up and outward (away from the body, on that arm's side). */
const PHONE_ARM = {
  upper: { idle: [0.12, -1, 0.16], read: [0.36, -1, 0.04], show: [0.3, 0.8, 0.62] },
  lower: { idle: [0.8, -0.6, -0.08], read: [0.75, 0.62, -0.38], show: [0.12, 1, 0.08] },
} as const;
const FREE_ARM = {
  upper: { idle: [0.05, -1, 0.17], tap: [0.5, -0.8, -0.05], show: [-0.12, -1, 0.42] },
  lower: { idle: [0.18, -1, 0], tap: [0.62, 0.5, -0.72], show: [0.35, -0.62, -0.85] },
} as const;

export function makeAvatar(rig: AvatarRig): Avatar {
  const { root, bones, phone } = rig;
  // The pose every frame starts from.
  const rest = new Map<Object3D, { quaternion: Quaternion; position: Vector3 }>();
  for (const bone of Object.values(bones)) rest.set(bone, { quaternion: bone.quaternion.clone(), position: bone.position.clone() });
  /** A bone's own turn on top of its rest: nodding (down is positive), turning to its left, and tipping to its right. */
  const nudge = (bone: Object3D, nod: number, left: number, tip: number) => {
    bone.quaternion.multiply(twist.setFromEuler(euler.set(-nod, left, -tip, "YXZ")));
  };

  function pose(p: AvatarPose) {
    for (const [bone, was] of rest) {
      bone.quaternion.copy(was.quaternion);
      bone.position.copy(was.position);
    }
    const breath = Math.sin(p.seconds * 1.933);
    const shift = Math.sin(p.seconds * 0.4833);
    const held = Math.max(p.read, p.show);

    // Standing easy: the weight moves from one foot to the other, the chest rises and falls.
    bones.hips.position.x += 0.012 * shift;
    nudge(bones.hips, 0, 0.04 * shift - 0.1 * p.show, 0.03 * shift);
    nudge(bones.spine, 0.01 + 0.04 * p.read - 0.05 * p.show, 0, -0.04 * shift);
    nudge(bones.chest, -0.012 * breath, 0, 0);

    // The head follows what it watches, and drops to the phone to read.
    root.updateMatrixWorld(true);
    root.worldToLocal(local.copy(p.watch));
    const towards = Math.max(-0.8, Math.min(0.8, Math.atan2(-local.z, local.x))) * (1 - 0.8 * p.read) - 0.1 * p.read;
    nudge(bones.neck, 0.12 * p.read - 0.04 * p.show, towards * 0.4, 0);
    nudge(bones.head, 0.05 + 0.26 * p.read - 0.12 * p.show + 0.012 * breath, towards * 0.6, 0.03 * shift);

    // The right arm holds the phone: low, then up to read, then high for the crew. The left taps, then rests on the hip.
    const bob = 0.03 * breath * (1 - held) + 0.03 * Math.sin(p.seconds * 3.87) * p.show;
    const upper = blend(PHONE_ARM.upper.idle, PHONE_ARM.upper.read, p.read, PHONE_ARM.upper.show, p.show);
    const lower = blend(PHONE_ARM.lower.idle, PHONE_ARM.lower.read, p.read, PHONE_ARM.lower.show, p.show);
    aim(root, bones.rightUpperArm, bones.rightLowerArm, heading(root, upper[0], upper[1], upper[2], want));
    aim(root, bones.rightLowerArm, bones.rightHand, heading(root, lower[0], lower[1] + bob, lower[2], want));
    const free = blend(FREE_ARM.upper.idle, FREE_ARM.upper.show, p.show, FREE_ARM.upper.tap, p.tap);
    const fore = blend(FREE_ARM.lower.idle, FREE_ARM.lower.show, p.show, FREE_ARM.lower.tap, p.tap);
    aim(root, bones.leftUpperArm, bones.leftLowerArm, heading(root, free[0], free[1], -free[2], want));
    aim(root, bones.leftLowerArm, bones.leftHand, heading(root, fore[0], fore[1], -fore[2], want));

    // The phone stands in the right hand: its screen to the reader, then turned to the crew.
    root.updateMatrixWorld(true);
    bones.rightHand.getWorldPosition(to);
    bones.rightLowerArm.getWorldPosition(from);
    phone.position.copy(to).addScaledVector(from.sub(to).normalize(), -0.11);
    heading(root, 1, 0, 0, want);
    phone.position.addScaledVector(want, 0.02 + 0.02 * p.show);
    phone.quaternion.copy(root.getWorldQuaternion(world)).multiply(twist.setFromEuler(euler.set(0, Math.PI * (1 - p.show) + 0.25 * p.show, 0.45 * (1 - held) - 0.22 * p.read + 0.08 * p.show, "XYZ")));

    // The face: eyes lowered to the phone, a blink now and then, a smile for the call, and eyes shut with it as the boulder goes.
    const faces: Record<AvatarFace, number> = { smile: 0.85 * p.smile * (1 - p.joy), joy: p.joy, blink: p.joy > 0.5 ? 0 : p.blink ? 1 : 0.35 * p.read * (1 - p.smile) };
    for (const mesh of rig.faces) {
      for (const name of Object.keys(faces) as AvatarFace[]) {
        const index = mesh.morphTargetDictionary?.[name];
        if (index !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = faces[name];
      }
    }
  }

  return {
    pose,
    phoneAt(out) {
      return phone.getWorldPosition(out);
    },
  };
}
