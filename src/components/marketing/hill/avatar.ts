import { Euler, Matrix4, Quaternion, Vector3, type Mesh, type Object3D } from "three";

import { bend } from "./rig";

/*
 * You, at the top: an anime character (VRoid's AvatarSample_C, public/marketing/models) posed on
 * its own skeleton. They stand easy, feet apart and the weight on one leg, breathe and shift, watch
 * the crew climb, read the question on the phone in their palm when it arrives, tap the answer with
 * a finger of the other hand, and then either smile and hold it up for the crew as the boulder
 * goes, or shrug, lower it and watch the boulder roll back down.
 *
 * A pose is worked out from the rest pose every time, never from the pose before, so a frame is a
 * function of the loop's progress (and the idle clock) alone. tests/hill.test.ts holds it to that.
 *
 * Directions here are (forward, up, right) of the character as it stands: `root`'s +x, +y and +z.
 * The model itself is built facing -z with its right at +x and its bones unturned at rest (a T-pose),
 * so a right hand's fingers run along +x, its palm faces -y and its thumb is on the -z side; the
 * left hand is the mirror of that in x.
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
  rightUpperLeg: "J_Bip_R_UpperLeg",
  rightLowerLeg: "J_Bip_R_LowerLeg",
  rightFoot: "J_Bip_R_Foot",
  leftUpperLeg: "J_Bip_L_UpperLeg",
  leftLowerLeg: "J_Bip_L_LowerLeg",
  leftFoot: "J_Bip_L_Foot",
} as const;
export type AvatarBone = keyof typeof AVATAR_BONES;

/** The fingers, from the hand out: each is three bones, `J_Bip_R_Index1` and so on. */
export const AVATAR_FINGERS = ["Thumb", "Index", "Middle", "Ring", "Little"] as const;
export type AvatarFinger = (typeof AVATAR_FINGERS)[number];
export type AvatarHand = Partial<Record<AvatarFinger, Object3D[]>>;

/** The faces the model can pull, as its morph targets are named (the build keeps these three). */
export type AvatarFace = "smile" | "joy" | "blink";

export interface AvatarRig {
  /** What stands on the hill: its +x is the way the character faces, +z their right, +y up. */
  root: Object3D;
  bones: Record<AvatarBone, Object3D>;
  /** The finger bones of each hand, where the model has them. */
  fingers: { right: AvatarHand; left: AvatarHand };
  /** The meshes of the face, whose morph targets are the expressions. */
  faces: Mesh[];
  /** The phone, a child of the scene: its +x is the screen's face and +y its top. It goes in the right palm. */
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
  /** 1 at the top of a shrug: the answer was to wait. */
  shrug: number;
  blink: boolean;
  /** Where to look, in the world. */
  watch: Vector3;
}

export interface Avatar {
  pose(pose: AvatarPose): void;
  /** The middle of the phone's screen, in the world, and (if asked) the way it faces. */
  phoneAt(out: Vector3, facing?: Vector3): Vector3;
  /** Between the eyes, in the world. */
  eyesAt(out: Vector3): Vector3;
  /** The tip of the left index finger, in the world: what taps. */
  fingertipAt(out: Vector3): Vector3;
}

/** The phone, in the model's metres: half its thickness, and where its middle sits from the wrist, along the fingers and off the palm. */
const PHONE = { halfThick: 0.007, along: 0.07, off: 0.021 };
/** Where the eyes are from the head bone, in the model's own axes (it faces -z). */
const EYES = new Vector3(0, 0.055, -0.045);
/** How far past its last bone a fingertip reaches, as a share of that bone's length. */
const TIP = 0.85;

const UP = new Vector3(0, 1, 0);
const from = new Vector3();
const to = new Vector3();
const want = new Vector3();
const local = new Vector3();
const joint = new Vector3();
const end = new Vector3();
const pole = new Vector3();
const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const turn = new Quaternion();
const parent = new Quaternion();
const world = new Quaternion();
const rootTurn = new Quaternion();
const twist = new Quaternion();
const euler = new Euler();
const basis = new Matrix4();

/** A unit quaternion for a frame whose +x is `x` and whose +y is as near `y` as it can be. */
function frame(x: Vector3, y: Vector3, out: Quaternion): Quaternion {
  a.copy(x).normalize();
  b.copy(y).addScaledVector(a, -y.dot(a)).normalize();
  c.crossVectors(a, b);
  return out.setFromRotationMatrix(basis.makeBasis(a, b, c));
}

export function makeAvatar(rig: AvatarRig): Avatar {
  const { root, bones, phone } = rig;
  root.updateMatrixWorld(true);
  const inRoot = (bone: Object3D, out: Vector3) => root.worldToLocal(bone.getWorldPosition(out));
  // The pose every frame starts from, and what is measured from it once: where the feet stand, how long the limbs are.
  const rest = new Map<Object3D, { quaternion: Quaternion; position: Vector3 }>();
  const remember = (bone: Object3D) => rest.set(bone, { quaternion: bone.quaternion.clone(), position: bone.position.clone() });
  Object.values(bones).forEach(remember);
  for (const hand of [rig.fingers.right, rig.fingers.left]) for (const finger of Object.values(hand)) finger?.forEach(remember);
  const span = (one: Object3D, other: Object3D) => inRoot(one, from).distanceTo(inRoot(other, to));
  const limbs = {
    rightArm: [span(bones.rightUpperArm, bones.rightLowerArm), span(bones.rightLowerArm, bones.rightHand)],
    leftArm: [span(bones.leftUpperArm, bones.leftLowerArm), span(bones.leftLowerArm, bones.leftHand)],
    rightLeg: [span(bones.rightUpperLeg, bones.rightLowerLeg), span(bones.rightLowerLeg, bones.rightFoot)],
    leftLeg: [span(bones.leftUpperLeg, bones.leftLowerLeg), span(bones.leftLowerLeg, bones.leftFoot)],
  } as const;
  const ankles = { right: inRoot(bones.rightFoot, new Vector3()), left: inRoot(bones.leftFoot, new Vector3()) };
  /** A foot's turn at rest, as the root sees it: flat on the ground, toes forward. */
  const flat = (foot: Object3D) => root.getWorldQuaternion(new Quaternion()).invert().multiply(foot.getWorldQuaternion(new Quaternion()));
  const soles = { right: flat(bones.rightFoot), left: flat(bones.leftFoot) };
  /** The left index fingertip from the wrist, in the hand's own axes. */
  const index = rig.fingers.left.Index;
  const tip = new Vector3(-0.148, 0, -0.03);
  if (index?.length === 3) tip.copy(index[0]!.position).add(index[1]!.position).addScaledVector(index[2]!.position, 1 + TIP);

  /** A bone's own turn on top of its rest: nodding (down is positive), turning to its left, and tipping to its right. */
  const nudge = (bone: Object3D, nod: number, left: number, tipped: number) => {
    bone.quaternion.multiply(twist.setFromEuler(euler.set(-nod, left, -tipped, "YXZ")));
  };
  /** A direction or an offset given as forward, up and right of the character, in the world (unit length, or in the model's metres if `metres`). */
  const heading = (forward: number, up: number, right: number, out: Vector3, metres = false) => {
    out.set(forward, up, right).applyQuaternion(rootTurn);
    return metres ? out.multiplyScalar(root.scale.x) : out.normalize();
  };
  /** Turns `bone` so that `child` lies along `direction` (in the world) from it. */
  const aim = (bone: Object3D, child: Object3D, direction: Vector3) => {
    root.updateMatrixWorld(true);
    bone.getWorldPosition(from);
    child.getWorldPosition(to).sub(from).normalize();
    turn.setFromUnitVectors(to, direction);
    bone.getWorldQuaternion(world);
    bone.parent!.getWorldQuaternion(parent).invert();
    bone.quaternion.copy(parent).multiply(turn).multiply(world);
  };
  /** Turns `bone` to a turn given in the world. */
  const face = (bone: Object3D, turned: Quaternion) => {
    root.updateMatrixWorld(true);
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(parent).invert()).multiply(turned);
  };
  /** Bends a limb of two bones so that its end (`hand`, a wrist or an ankle) is at `target` in the world, the middle joint towards `towards`. */
  const reach = (upper: Object3D, lower: Object3D, hand: Object3D, lengths: readonly number[], target: Vector3, towards: Vector3) => {
    root.updateMatrixWorld(true);
    upper.getWorldPosition(local);
    bend(local, target, lengths[0]! * root.scale.x, lengths[1]! * root.scale.x, towards, joint, end);
    aim(upper, lower, want.copy(joint).sub(local).normalize());
    aim(lower, hand, want.copy(end).sub(joint).normalize());
  };
  /** Curls a finger towards the palm: so many radians at each of its three joints. `side` is 1 for the left hand, -1 for the right. */
  const curl = (finger: Object3D[] | undefined, side: number, ...angles: number[]) => {
    finger?.forEach((bone, at) => bone.quaternion.multiply(twist.setFromEuler(euler.set(0, 0, side * (angles[at] ?? 0)))));
  };

  const eyes = new Vector3();
  const screen = new Vector3();
  const held = new Quaternion();
  const reading = new Quaternion();
  const showing = new Quaternion();
  const grip = new Quaternion();
  const across = new Vector3();
  const palm = new Vector3();
  const place = new Vector3();
  const wrist = new Vector3();
  const free = { upper: new Quaternion(), lower: new Quaternion(), hand: new Quaternion() };

  function eyesAt(out: Vector3): Vector3 {
    root.updateMatrixWorld(true);
    return bones.head.localToWorld(out.copy(EYES));
  }

  function pose(p: AvatarPose) {
    for (const [bone, was] of rest) {
      bone.quaternion.copy(was.quaternion);
      bone.position.copy(was.position);
    }
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(rootTurn);
    const breath = Math.sin(p.seconds * 1.933);
    const shift = Math.sin(p.seconds * 0.4833);
    const carried = Math.max(p.read, p.show);

    // Standing easy: feet apart, the weight on the left leg and the hip dropped over it, the right knee soft.
    // The weight moves a little from one foot to the other, and the chest rises and falls.
    bones.hips.position.x += -0.026 + 0.011 * shift;
    bones.hips.position.y -= 0.016 - 0.003 * shift;
    nudge(bones.hips, 0, 0.05 + 0.03 * shift - 0.08 * p.show, -0.045 + 0.02 * shift);
    nudge(bones.spine, 0.01 + 0.04 * p.read - 0.05 * p.show, -0.03, 0.05 - 0.025 * shift);
    nudge(bones.chest, -0.012 * breath - 0.03 * p.shrug, 0, 0);
    // The feet stay where they are planted, whatever the hips do: each leg bends to reach its own.
    for (const [side, out] of [["right", 1], ["left", -1]] as const) {
      const [upper, lower, foot] = [bones[`${side}UpperLeg`], bones[`${side}LowerLeg`], bones[`${side}Foot`]];
      place.copy(ankles[side]).add(want.set(side === "right" ? 0.045 : -0.02, 0, out * 0.04));
      reach(upper, lower, foot, limbs[`${side}Leg`], root.localToWorld(place), heading(1, 0.05, out * 0.22, pole));
      // Toes a little out, soles flat.
      face(foot, world.copy(rootTurn).multiply(twist.setFromAxisAngle(UP, -out * 0.2)).multiply(soles[side]));
    }

    // The head follows what it watches, and drops to the phone to read.
    root.updateMatrixWorld(true);
    root.worldToLocal(local.copy(p.watch));
    const towards = Math.max(-0.8, Math.min(0.8, Math.atan2(-local.z, local.x))) * (1 - 0.8 * p.read) - 0.1 * p.read;
    nudge(bones.neck, 0.14 * p.read - 0.04 * p.show, towards * 0.4, 0);
    nudge(bones.head, 0.05 + 0.3 * p.read - 0.12 * p.show + 0.012 * breath, towards * 0.6, 0.03 * shift + 0.12 * p.shrug);

    // Where the phone is and how it is turned: low at the side with its screen up, before the eyes to read
    // (its screen square to them), and held up and out with its screen to the crew.
    eyesAt(eyes);
    root.updateMatrixWorld(true);
    bones.rightUpperArm.getWorldPosition(from);
    const bob = 0.006 * breath * (1 - carried) + 0.008 * Math.sin(p.seconds * 3.87) * p.show;
    screen.copy(from).add(heading(0.2, -0.38 + bob, 0.05, want, true));
    place.copy(eyes).add(heading(0.29, -0.2, 0.035, want, true));
    screen.lerp(place, p.read);
    screen.lerp(place.copy(from).add(heading(0.2, 0.4 + bob, 0.2, want, true)), p.show);
    frame(heading(-0.4, 0.9, -0.12, a), heading(0.9, 0.4, 0, b), held);
    frame(want.copy(eyes).sub(place.copy(eyes).add(heading(0.29, -0.2, 0.035, c, true))), heading(0, 1, 0, b), reading);
    frame(heading(1, 0.08, -0.1, a), heading(0, 1, 0, b), showing);
    held.slerp(reading, p.read).slerp(showing, p.show);

    // The right hand takes it in its palm: the palm to the phone's back, the fingers across the back and round
    // its far edge, the thumb up the near edge onto the glass. The arm brings the wrist to where that puts it.
    palm.set(1, 0, 0).applyQuaternion(held);
    across.set(0, 0.34, 0.94).applyQuaternion(held);
    wrist.copy(screen).addScaledVector(palm, -(PHONE.off + PHONE.halfThick) * root.scale.x).addScaledVector(across, -PHONE.along * root.scale.x);
    reach(bones.rightUpperArm, bones.rightLowerArm, bones.rightHand, limbs.rightArm, wrist, heading(-0.45, -1, 0.5 - 0.3 * p.read, pole));
    // The hand's +x (its fingers) across the phone, its -y (the palm) to the phone's back.
    face(bones.rightHand, frame(across, want.copy(palm).negate(), grip));
    for (const finger of ["Index", "Middle", "Ring", "Little"] as const) curl(rig.fingers.right[finger], -1, 0.12, 1.4, 0.55);
    // The thumb comes down round the near edge (a turn about the hand's length) and lies on the glass.
    rig.fingers.right.Thumb?.forEach((bone, at) => bone.quaternion.multiply(twist.setFromEuler(euler.set([-1.05, -0.25, -0.1][at]!, 0, 0))));
    // The phone goes where the hand has it (the same place, unless the arm could not reach).
    root.updateMatrixWorld(true);
    bones.rightHand.getWorldPosition(from);
    phone.position.copy(from).addScaledVector(across, PHONE.along * root.scale.x).addScaledVector(palm, PHONE.off * root.scale.x);
    phone.quaternion.copy(held);
    phone.updateMatrixWorld(true);

    // The left arm hangs, or rests its hand on the hip while the answer is held up, or lifts in a shrug.
    const hang = [0.05 + 0.1 * p.shrug, -1, 0.17 + 0.25 * p.shrug];
    const hip = [-0.12, -1, 0.42];
    const fore = [0.18 + 0.5 * p.shrug, -1 + 0.6 * p.shrug, 0.25 * p.shrug];
    const onHip = [0.35, -0.62, -0.85];
    const mix = (one: number[], other: number[], at: number) => one[at]! + (other[at]! - one[at]!) * p.show;
    aim(bones.leftUpperArm, bones.leftLowerArm, heading(mix(hang, hip, 0), mix(hang, hip, 1), -mix(hang, hip, 2), want));
    aim(bones.leftLowerArm, bones.leftHand, heading(mix(fore, onHip, 0), mix(fore, onHip, 1), -mix(fore, onHip, 2), want));
    for (const finger of ["Index", "Middle", "Ring", "Little"] as const) curl(rig.fingers.left[finger], 1, 0.25, 0.3, 0.2);
    if (p.tap > 0.001) {
      // To tap, its index finger goes to the glass: the hand comes in from the left, palm down, the other fingers curled.
      free.upper.copy(bones.leftUpperArm.quaternion);
      free.lower.copy(bones.leftLowerArm.quaternion);
      free.hand.copy(bones.leftHand.quaternion);
      a.set(-0.66, 0.1, -0.74).applyQuaternion(held).normalize();
      b.set(-0.45, -0.8, 0.2).applyQuaternion(held);
      // The left hand's -x (its fingers) along `a`, its -y (the palm) along `b`.
      frame(want.copy(a).negate(), place.copy(b).negate(), grip);
      place.set(PHONE.halfThick + 0.002, -0.02, 0).applyQuaternion(held).multiplyScalar(root.scale.x).add(phone.position);
      wrist.copy(tip).applyQuaternion(grip).multiplyScalar(-root.scale.x).add(place);
      reach(bones.leftUpperArm, bones.leftLowerArm, bones.leftHand, limbs.leftArm, wrist, heading(-0.3, -1, -0.6, pole));
      face(bones.leftHand, grip);
      bones.leftUpperArm.quaternion.slerpQuaternions(free.upper, twist.copy(bones.leftUpperArm.quaternion), p.tap);
      root.updateMatrixWorld(true);
      bones.leftLowerArm.quaternion.slerpQuaternions(free.lower, twist.copy(bones.leftLowerArm.quaternion), p.tap);
      bones.leftHand.quaternion.slerpQuaternions(free.hand, twist.copy(bones.leftHand.quaternion), p.tap);
      for (const finger of ["Middle", "Ring", "Little"] as const) curl(rig.fingers.left[finger], 1, 0.9 * p.tap, 1.1 * p.tap, 0.6 * p.tap);
      curl(rig.fingers.left.Index, 1, -0.25 * p.tap, -0.3 * p.tap, -0.2 * p.tap);
    }

    // The face: eyes lowered to the phone, a blink now and then, a smile for the call, and eyes shut with it as the boulder goes.
    const faces: Record<AvatarFace, number> = { smile: 0.85 * p.smile * (1 - p.joy), joy: p.joy, blink: p.joy > 0.5 ? 0 : p.blink ? 1 : 0.35 * p.read * (1 - p.smile) };
    for (const mesh of rig.faces) {
      for (const name of Object.keys(faces) as AvatarFace[]) {
        const at = mesh.morphTargetDictionary?.[name];
        if (at !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[at] = faces[name];
      }
    }
  }

  return {
    pose,
    phoneAt(out, facing) {
      facing?.set(1, 0, 0).applyQuaternion(phone.quaternion);
      return out.set(PHONE.halfThick, 0, 0).applyQuaternion(phone.quaternion).multiplyScalar(root.scale.x).add(phone.position);
    },
    eyesAt,
    fingertipAt(out) {
      root.updateMatrixWorld(true);
      return bones.leftHand.localToWorld(out.copy(tip));
    },
  };
}
