import { Euler, Matrix4, Quaternion, Vector3, type Object3D } from "three";

import { PALM, REACH, type Bot } from "./bot";
import { BEATS, BOULDER_R, IDLE_BEATS, START_X, TOP_X, type CrewLook } from "./cast";
import { band, clamp01 } from "./noise";
import { FACE, hillSurface, pathLength, pathPoint, pathSlope, pathTurn, pathZ } from "./terrain";
import { stoneAt } from "./textures";

/*
 * The loop's score and the crew's places in it. Everything here is a function of how far through
 * the loop we are and nothing else: no frame remembers the one before, so the hundredth loop is the
 * first one again, and a frame drawn alone (a paused page, a still for reduced motion) is the frame
 * the running loop would have drawn. tests/hill.test.ts holds it to that.
 */

export { BEATS, BOULDER_R, CREW, LOOP_SECONDS, START_X, TOP_X, type CrewLook } from "./cast";

/** How far down the path the crew walks before the loop ends: enough to take the last of them out of the frame. */
const DESCENT = 9.7;

export interface Member extends CrewLook {
  bot: Bot;
  /** Where its wrists go when it pushes, in the world. */
  hands: readonly [Vector3, Vector3];
}

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

/** Where everything in the loop stands at one moment of it. */
export interface Score {
  /** 0..1 through the loop, and the same as an angle. */
  p: number;
  turn: number;
  /** The idle clock: it wraps with the loop. */
  seconds: number;
  /** The boulder: where on the path, and how much ground it has covered. */
  x: number;
  travelled: number;
  /** 1 as the boulder has gathered all its light; 1 once it has gone; its light, 1 to 0, after. */
  charge: number;
  gone: number;
  fading: number;
  /** The crew: leaning into the push, arms up, turned about (radians), walking free, and how far back down the path. */
  push: number;
  cheer: number;
  about: number;
  walk: number;
  down: number;
  /** The person: reading the question, tapping, holding the answer up, pleased, eyes shut with it. */
  read: number;
  tap: number;
  show: number;
  smile: number;
  joy: number;
}

/** `idle` is the idle clock in beats, for motion that runs on while the loop is held; left out, it follows the loop. */
export function scoreAt(progress: number, idle?: number): Score {
  const p = ((progress % 1) + 1) % 1;
  const x = START_X + (TOP_X - START_X) * climb(p);
  const answered = band(p, BEATS.tap + 0.008, BEATS.flash - 0.005);
  return {
    p,
    turn: p * Math.PI * 2,
    seconds: idle ?? p * IDLE_BEATS,
    x,
    travelled: pathLength(START_X, x),
    charge: band(p, BEATS.charge, BEATS.flash),
    gone: band(p, BEATS.flash, BEATS.flash + 0.014),
    fading: 1 - band(p, BEATS.flash, BEATS.dark),
    push: 1 - band(p, BEATS.top - 0.004, BEATS.top + 0.045),
    cheer: band(p, BEATS.flash, BEATS.flash + 0.025) * (1 - band(p, BEATS.turn - 0.03, BEATS.turn)),
    about: Math.PI * band(p, BEATS.turn, BEATS.turn + 0.035),
    walk: band(p, BEATS.descend, BEATS.descend + 0.02),
    down: DESCENT * descend(p),
    read: band(p, BEATS.top + 0.005, BEATS.top + 0.05) * (1 - answered),
    tap: Math.exp(-(((p - BEATS.tap) / 0.012) ** 2)),
    show: answered * (1 - band(p, BEATS.turn - 0.025, BEATS.turn + 0.015)),
    smile: band(p, BEATS.tap - 0.004, BEATS.tap + 0.02) * (1 - band(p, BEATS.turn + 0.02, BEATS.turn + 0.1)),
    joy: band(p, BEATS.flash - 0.004, BEATS.flash + 0.012) * (1 - band(p, BEATS.dark - 0.02, BEATS.dark + 0.01)),
  };
}

const normal = new Vector3();
const tangent = new Vector3();
const upward = new Vector3();
const sideways = new Vector3();
const forward = new Vector3();
const reach = new Vector3();
const facing = new Vector3();
const shoulders = new Vector3();
const ahead = new Vector3();
const basis = new Matrix4();
const roll = new Euler();
const unroll = new Quaternion();

/** A point `lift` above the path at x, measured square to the slope; `square`, if given, takes the slope's normal. */
export function onPath(x: number, lift: number, out: Vector3, square: Vector3 = normal): Vector3 {
  const [px, py, pz] = pathPoint(x);
  square.set(-pathSlope(x), 1, FACE).normalize();
  return out.set(px, py, pz).addScaledVector(square, lift);
}

/** The boulder's centre as it rests on the path (before it lifts to go), and how it has turned: as far as it has rolled. */
export function placeBoulder(score: Score, centre: Vector3, turned: Quaternion) {
  onPath(score.x, BOULDER_R * 0.95, centre);
  turned.setFromEuler(roll.set(0, -Math.atan(pathTurn(score.x)), -score.travelled / BOULDER_R - 1.2 * score.charge * score.charge));
}

/**
 * Stands a bot on the hill at (x, z): leaning with the slope as far as `lean` says, heading up the
 * hill along `heading` (as dz/dx), and turned `about` radians from that, round by the camera's side.
 */
function stand(root: Object3D, x: number, z: number, heading: number, lean: number, about: number) {
  root.position.set(x, hillSurface(x, z), z);
  tangent.set(1, pathSlope(x) * lean, heading).normalize();
  sideways.crossVectors(tangent, upward.set(0, 1, 0)).normalize();
  upward.crossVectors(sideways, tangent);
  forward.copy(tangent).multiplyScalar(Math.cos(about)).addScaledVector(sideways, Math.sin(about));
  sideways.crossVectors(forward, upward);
  root.quaternion.setFromRotationMatrix(basis.makeBasis(forward, upward, sideways));
}

/** The search for where a pushing bot stands: it comes up from this far back, in steps of this, and the last step is halved this many times (to a tenth of a millimetre). */
const BACK_OFF = 1.3;
const STEP = 0.1;
const HALVINGS = 10;

/**
 * Puts the crew where the score has them, and poses them: pushing the boulder (centre and turn from
 * `placeBoulder`), each with its hands on what is ahead, standing back at the top, cheering, and
 * walking back down.
 */
export function placeCrew(score: Score, crew: readonly Member[], centre: Vector3, turned: Quaternion) {
  const { push, cheer, walk, about, down, seconds, turn } = score;
  unroll.copy(turned).invert();
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
    const pose = (pushing: number) =>
      bot.pose({
        push: pushing,
        cheer,
        walk,
        distance: score.travelled + down,
        seconds,
        hands: member.hands,
        headTurn: (member.turn + 0.5 * glance) * pushing + (0.3 + 0.12 * index) * (1 - pushing) * (1 - walk) + 0.35 * cheer - (0.3 + 0.55 * glance) * walk,
        headTilt: 0.06 * Math.sin(turn * 4 + index) + (0.32 - 0.05 * index) * (1 - pushing) * (1 - walk),
        blink: (seconds / 3.25 + index * 0.37) % 1 < 0.04,
      });

    // While it pushes, each one closes up until its hands are on what is ahead: worked out afresh every
    // frame, from its rough place, so the answer never depends on where it stood the frame before.
    /*
     * While it pushes, each one closes up until its hands are on what is ahead: worked out afresh every
     * frame, never from where it stood the frame before. The first comes up the path, square to the
     * boulder so both hands reach it on a bend; each of the others comes up straight behind the pack
     * of the one ahead (already in its place), as a line of people pushing does.
     */
    member.hands[0].set(0, 0, 0);
    member.hands[1].set(0, 0, 0);
    let pushX = 0;
    let pushZ = 0;
    let pushHeading = 0;
    if (push > 0) {
      let lineX = 1;
      let lineZ = 0;
      if (index > 0) {
        crew[index - 1]!.bot.back(0, ahead, facing);
        crew[index - 1]!.bot.back(1, reach, facing);
        ahead.add(reach).multiplyScalar(0.5);
        const flat = Math.hypot(facing.x, facing.z) || 1;
        lineX = -facing.x / flat;
        lineZ = -facing.z / flat;
      }
      // Stands it `back` from what it pushes, and says how far the farther wrist is beyond a bent arm's reach of its shoulder.
      const short = (back: number) => {
        if (index === 0) {
          pushX = score.x - back;
          pushZ = pathZ(pushX) + member.aside;
          const along = pathTurn(pushX);
          pushHeading = Math.min(along + 0.6, Math.max(along - 0.6, (centre.z - pushZ) / Math.max(0.4, centre.x - pushX)));
        } else {
          pushX = ahead.x - lineX * back;
          pushZ = ahead.z - lineZ * back;
          pushHeading = lineZ / Math.max(0.3, lineX);
        }
        stand(bot.root, pushX, pushZ, pushHeading, 1, 0);
        pose(1);
        reachOut();
        const far = Math.max(member.hands[0].distanceTo(bot.shoulder(0, shoulders)), member.hands[1].distanceTo(bot.shoulder(1, shoulders)));
        return far - REACH * member.scale;
      };
      let back = index === 0 ? BOULDER_R + BACK_OFF : BACK_OFF;
      let near = back;
      while (near > 0.2 && short(near) > 0) {
        back = near;
        near -= STEP;
      }
      for (let halving = 0; halving < HALVINGS; halving += 1) {
        const middle = (back + near) / 2;
        if (short(middle) > 0) back = middle;
        else near = middle;
      }
      short(near);
    }
    // Stood back from the load once it rests, on the path again, and off down the hill when the work is done.
    const restX = score.x - (member.behind + 0.2) * 0.94 - down;
    const restZ = pathZ(restX) + member.aside;
    const x = restX + (pushX - restX) * push;
    stand(bot.root, x, restZ + (pushZ - restZ) * push, pathTurn(x) + (pushHeading - pathTurn(x)) * push, 0.35 + 0.65 * push, about);
    pose(push);
    if (push > 0) {
      reachOut();
      pose(push);
    }
  });
}
