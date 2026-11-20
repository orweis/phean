import { MeshBasicMaterial, Object3D, Quaternion, Vector3 } from "three";
import { describe, expect, test } from "vitest";

import { AVATAR_BONES, makeAvatar, type AvatarBone, type AvatarHand, type AvatarPose } from "@/components/marketing/hill/avatar";
import { makeBot, makeBotKit, PALM, type BotMaterials } from "@/components/marketing/hill/bot";
import { BOULDER_PATTERNS, boulderOf } from "@/components/marketing/hill/cast";
import { BEATS, BOULDER_R, CREW, placeBoulder, placeCrew, ROLLBACK, scoreAt, type Attention, type Branch, type Member } from "@/components/marketing/hill/crew";
import { stoneAt } from "@/components/marketing/hill/textures";
import { LOOK_PLANE, pointOn, project } from "@/components/marketing/hill/view";
import { approach, AUTO_LOOPS, branchAt, HOLD_AT, holdTime, LOOP_MS, momentAt } from "@/components/marketing/hill/timeline";

/** The landing page's boulder scene, without a renderer: the same bots, placed by the same score. */
function stage() {
  const kit = makeBotKit();
  const material = new MeshBasicMaterial();
  const materials: BotMaterials = { shell: material, dark: material, trim: material, visor: material, eye: material, tip: material };
  const crew: Member[] = CREW.map((look) => ({ ...look, bot: makeBot(kit, materials, look), hands: [new Vector3(), new Vector3()] as const }));
  const centre = new Vector3();
  const turned = new Quaternion();
  /** Draws one frame and says where everything ended up. */
  function frame(progress: number, branch: Branch = "ship", loop = 1, look?: Attention) {
    const score = scoreAt(progress, undefined, branch, loop);
    placeBoulder(score, centre, turned);
    placeCrew(score, crew, centre, turned, look);
    return {
      score,
      boulder: centre.toArray(),
      crew: crew.map(({ bot, hands, scale }) => {
        bot.root.updateMatrixWorld(true);
        return {
          scale,
          feet: bot.root.position.toArray(),
          facing: bot.root.quaternion.toArray(),
          wrists: hands.map((hand) => hand.toArray()),
          shoulders: ([0, 1] as const).map((side) => bot.shoulder(side, new Vector3()).toArray()),
          tip: bot.tipAt(new Vector3()).toArray(),
          eyes: bot.eyesAt(new Vector3()).toArray(),
          sight: bot.sightAlong(new Vector3()).toArray(),
          gaze: look ? bot.gaze(look.point) : { turn: 0, tilt: 0 },
        };
      }),
    };
  }
  return { frame };
}

/** The largest difference between two snapshots' numbers. */
function apart(a: unknown, b: unknown): number {
  const numbers = (value: unknown): number[] => (typeof value === "number" ? [value] : typeof value !== "object" || value === null ? [] : Array.isArray(value) ? value.flatMap(numbers) : Object.values(value as object).flatMap(numbers));
  const [left, right] = [numbers(a), numbers(b)];
  return left.length === right.length ? Math.max(...left.map((value, index) => Math.abs(value - right[index]!))) : Infinity;
}

const distance = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("the boulder scene's crew", () => {
  test("a frame depends on where the loop is and on nothing before it: the third loop is the first", () => {
    const { frame } = stage();
    const FRAMES = 180;
    const loops: ReturnType<typeof frame>[][] = [[], [], []];
    // Three loops, frame after frame, as the page runs them.
    for (let loop = 0; loop < 3; loop += 1) for (let i = 0; i < FRAMES; i += 1) loops[loop]!.push(frame(loop + i / FRAMES));
    for (let i = 0; i < FRAMES; i += 1) {
      expect(apart(loops[2]![i]!.boulder, loops[0]![i]!.boulder)).toBeLessThan(1e-6);
      expect(apart(loops[2]![i]!.crew, loops[0]![i]!.crew)).toBeLessThan(1e-6);
    }
    // And a frame drawn on its own, out of order, is the frame the running loop drew.
    const fresh = stage();
    for (const i of [171, 3, 90, 40, 0, 75]) expect(apart(fresh.frame(i / FRAMES).crew, loops[0]![i]!.crew)).toBeLessThan(1e-9);
  });

  test("while they push, hands are on what is ahead and nobody is inside the boulder or each other", () => {
    const { frame } = stage();
    for (let p = 0; p <= BEATS.top - 0.01; p += 0.004) {
      const { boulder, crew } = frame(p);
      crew.forEach((bot, index) => {
        // Feet and antenna tip clear of the stone (its dents stand at most 5% proud of its radius).
        expect(distance(bot.feet, boulder)).toBeGreaterThan(BOULDER_R * 1.1);
        expect(distance(bot.tip, boulder)).toBeGreaterThan(BOULDER_R * 1.06);
        for (const side of [0, 1]) {
          // Each wrist is within the arm's reach of its shoulder, so the hand is where the pose put it.
          expect(distance(bot.wrists[side]!, bot.shoulders[side]!)).toBeLessThan(0.47 * bot.scale);
          if (index > 0) continue;
          // The lead's wrists are a palm off the stone's surface, and its shoulders stand well clear of it.
          expect(Math.abs(distance(bot.wrists[side]!, boulder) - BOULDER_R - PALM * bot.scale)).toBeLessThan(BOULDER_R * 0.07);
          expect(distance(bot.shoulders[side]!, boulder)).toBeGreaterThan(BOULDER_R * 1.18);
        }
        // Nose to tail, each one well behind the one ahead.
        if (index > 0) expect(distance(crew[index - 1]!.feet, bot.feet)).toBeGreaterThan(0.5 * bot.scale);
      });
    }
  });

  test("the loop begins and ends with the crew and the boulder out of the frame", () => {
    const { frame } = stage();
    for (const p of [0, 0.9995]) {
      const { boulder, crew, score } = frame(p);
      // The frame's left edge is near x = -6.9 on the path.
      if (score.gone < 1) expect(boulder[0]! + BOULDER_R).toBeLessThan(-7.2);
      for (const bot of crew) expect(bot.feet[0]!).toBeLessThan(-7.6);
    }
  });
});

/** A stick figure with the model's bones, in a T-pose facing -z as the model does, stood as the scene stands it. */
function stick() {
  const root = new Object3D();
  root.position.set(5, 2.2, 0.3);
  root.rotation.y = Math.PI + 0.72;
  root.scale.setScalar(1.3);
  const model = new Object3D();
  model.rotation.y = -Math.PI / 2;
  root.add(model);
  const bones = {} as Record<AvatarBone, Object3D>;
  const bone = (name: AvatarBone, parent: Object3D, x: number, y: number, z: number) => {
    const made = new Object3D();
    made.name = AVATAR_BONES[name];
    made.position.set(x, y, z);
    parent.add(made);
    bones[name] = made;
    return made;
  };
  const hips = bone("hips", model, 0, 1, 0);
  const chest = bone("chest", bone("spine", hips, 0, 0.1, 0), 0, 0.15, 0);
  bone("head", bone("neck", chest, 0, 0.25, 0), 0, 0.1, 0);
  const fingers = { right: {} as AvatarHand, left: {} as AvatarHand };
  for (const [side, sign] of [["right", 1], ["left", -1]] as const) {
    const hand = bone(`${side}Hand`, bone(`${side}LowerArm`, bone(`${side}UpperArm`, chest, 0.16 * sign, 0.2, 0), 0.22 * sign, 0, 0), 0.28 * sign, 0, 0);
    bone(`${side}Foot`, bone(`${side}LowerLeg`, bone(`${side}UpperLeg`, hips, 0.085 * sign, -0.04, 0), 0, -0.4, 0), 0, -0.46, 0.03);
    // An index finger: three joints out along the hand, a little to the thumb's side.
    const joints: Object3D[] = [];
    [0.07, 0.036, 0.022].reduce((parent, length, at) => {
      const joint = new Object3D();
      joint.position.set(length * sign, 0, at === 0 ? -0.024 : -0.004);
      parent.add(joint);
      joints.push(joint);
      return joint;
    }, hand);
    fingers[side].Index = joints;
  }
  const phone = new Object3D();
  const avatar = makeAvatar({ root, bones, fingers, faces: [], phone });
  const snapshot = () => {
    root.updateMatrixWorld(true);
    return Object.values(bones).flatMap((b) => [...b.quaternion.toArray(), ...b.getWorldPosition(new Vector3()).toArray()]).concat(phone.position.toArray());
  };
  const at = (progress: number, idle?: number, branch: Branch = "ship") => {
    const score = scoreAt(progress, idle, branch);
    const pose: AvatarPose = { seconds: score.seconds, read: score.read, tap: score.tap, show: score.show, smile: score.smile, joy: score.joy, shrug: score.shrug, blink: false, watch: new Vector3(-3 + 5 * score.p, 1, 0) };
    avatar.pose(pose);
    return snapshot();
  };
  return { at, bones, root, avatar };
}

describe("the boulder scene's person", () => {
  test("a pose is worked out from rest every time: the same moment is the same pose, whatever came before", () => {
    const person = stick();
    const first = [0.1, 0.3, 0.5, HOLD_AT, 0.56, 0.62, 0.8].map((p) => person.at(p));
    // Other moments in between, in another order, and then the same ones again.
    for (const p of [0.9, 0.58, 0.02, 0.47, 0.7]) person.at(p);
    [0.1, 0.3, 0.5, HOLD_AT, 0.56, 0.62, 0.8].forEach((p, index) => expect(apart(person.at(p), first[index])).toBeLessThan(1e-9));
    // And a figure that has never been posed before agrees.
    expect(apart(stick().at(0.62), first[5])).toBeLessThan(1e-9);
  });

  test("the phone is read at the chest, then held up above the head; while it waits, only the idle motion moves", () => {
    const person = stick();
    const height = (name: AvatarBone) => person.bones[name].getWorldPosition(new Vector3()).y;
    person.at(HOLD_AT);
    expect(height("rightHand")).toBeGreaterThan(height("hips"));
    expect(height("rightHand")).toBeLessThan(height("head"));
    const waiting = person.at(HOLD_AT, 3);
    expect(apart(person.at(HOLD_AT, 3), waiting)).toBeLessThan(1e-9);
    expect(apart(person.at(HOLD_AT, 3.4), waiting)).toBeGreaterThan(1e-4);
    person.at(0.62);
    expect(height("rightHand")).toBeGreaterThan(height("head") + 0.1);
    expect(height("leftHand")).toBeLessThan(height("chest"));
  });

  test("reading, the screen faces the eyes from a forearm away; at the tap, the left index fingertip is on the glass", () => {
    const person = stick();
    const [screen, facing, eyes, tip] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
    for (const p of [BEATS.top + 0.06, HOLD_AT, BEATS.tap]) {
      person.at(p);
      person.avatar.phoneAt(screen, facing);
      person.avatar.eyesAt(eyes);
      // Within 10 degrees of square to the eyes, about 30cm away (the figure is 1.3 times life size).
      const toEyes = eyes.clone().sub(screen);
      expect(toEyes.clone().normalize().angleTo(facing)).toBeLessThan((10 * Math.PI) / 180);
      expect(toEyes.length() / 1.3).toBeGreaterThan(0.24);
      expect(toEyes.length() / 1.3).toBeLessThan(0.4);
    }
    person.at(BEATS.tap);
    person.avatar.phoneAt(screen, facing);
    person.avatar.fingertipAt(tip).sub(screen);
    // On the glass to within 4mm, and within the screen's face.
    expect(Math.abs(tip.dot(facing)) / 1.3).toBeLessThan(0.004);
    expect(tip.length() / 1.3).toBeLessThan(0.05);
    // Held up, the screen is turned to the crew: away from the eyes.
    person.at(0.62);
    person.avatar.phoneAt(screen, facing);
    expect(person.avatar.eyesAt(eyes).sub(screen).normalize().dot(facing)).toBeLessThan(0);
  });

  test("the feet stay planted, apart, while the weight shifts over them", () => {
    const person = stick();
    const foot = (name: AvatarBone) => person.bones[name].getWorldPosition(new Vector3());
    person.at(0.3, 0);
    const [right, left] = [foot("rightFoot"), foot("leftFoot")];
    // About hip width (the figure is 1.3 times life size), and wider than the bones are at rest.
    expect(right.distanceTo(left) / 1.3).toBeGreaterThan(0.2);
    expect(right.distanceTo(left) / 1.3).toBeLessThan(0.32);
    for (const [p, idle] of [[0.3, 3.3], [0.5, 7.1], [HOLD_AT, 11], [0.62, 2], [0.8, 5]] as const) {
      person.at(p, idle);
      expect(foot("rightFoot").distanceTo(right)).toBeLessThan(1e-6);
      expect(foot("leftFoot").distanceTo(left)).toBeLessThan(1e-6);
    }
  });
});

describe("the boulder scene's clock", () => {
  test("two loops play through; the third stops at the question, and so does every one after", () => {
    expect(AUTO_LOOPS).toBe(2);
    expect(HOLD_AT).toBeGreaterThan(BEATS.top + 0.05); // the card is up
    expect(HOLD_AT).toBeLessThan(BEATS.tap - 0.02); // and nothing is tapped
    for (let loop = 0; loop < AUTO_LOOPS; loop += 1) {
      // Through the decision point of each of the first two, untouched.
      for (const p of [0, 0.3, HOLD_AT, BEATS.tap, 0.8, 0.999]) {
        const moment = momentAt((loop + p) * LOOP_MS, 0);
        expect(moment.held).toBe(false);
        expect(moment.loop).toBe(loop + 1);
        expect(moment.progress).toBeCloseTo(p, 9);
      }
    }
    // Loops 3, 4, 5, ...: each stops at the question until its call is made, and not a moment before.
    for (let answered = 0; answered < 6; answered += 1) {
      const loop = AUTO_LOOPS + answered + 1;
      expect(holdTime(answered)).toBeCloseTo((loop - 1 + HOLD_AT) * LOOP_MS, 6);
      expect(momentAt(holdTime(answered) - 1, answered).held).toBe(false);
      const held = momentAt(holdTime(answered), answered);
      expect(held).toMatchObject({ held: true, loop });
      expect(held.progress).toBeCloseTo(HOLD_AT, 9);
    }
  });

  test("a clock that ran on unseen is still at the hold: no loop is skipped and none is counted twice", () => {
    for (const answered of [0, 1, 4]) {
      for (const late of [1, 500, LOOP_MS * 0.6, LOOP_MS * 7.3]) {
        const moment = momentAt(holdTime(answered) + late, answered);
        expect(moment).toMatchObject({ held: true, time: holdTime(answered), loop: AUTO_LOOPS + answered + 1 });
        expect(moment.progress).toBeCloseTo(HOLD_AT, 9);
      }
    }
    expect(momentAt(-50, 0)).toMatchObject({ time: 0, progress: 0, loop: 1, held: false });
  });

  test("the call made, it goes on from there, and stops again at the next loop's question", () => {
    const from = holdTime(0);
    // The moment after the answer is the moment before it: nothing jumps.
    expect(momentAt(from, 1)).toMatchObject({ held: false, time: from, loop: AUTO_LOOPS + 1 });
    expect(momentAt(from, 1).progress).toBeCloseTo(HOLD_AT, 9);
    // The rest of that loop and the start of the next, untouched; then the next question.
    expect(holdTime(1) - from).toBe(LOOP_MS);
    for (let elapsed = from; elapsed < holdTime(1); elapsed += LOOP_MS / 7) expect(momentAt(elapsed, 1).held).toBe(false);
    expect(momentAt(holdTime(1), 1)).toMatchObject({ held: true, loop: AUTO_LOOPS + 2 });
    expect(momentAt(holdTime(1) + LOOP_MS * 3, 1).time).toBe(holdTime(1));
    expect(momentAt(holdTime(1), 2).held).toBe(false);
  });

  test("what follows the pointer eases to it: halfway in a half-life, the same however the time is cut, never past it", () => {
    expect(approach(0, 1, 100, 100)).toBeCloseTo(0.5, 12);
    expect(approach(0, 1, 0, 100)).toBe(0);
    expect(approach(0.3, 0.3, 50, 100)).toBe(0.3);
    // One step of 90ms is three of 30ms.
    let stepped = 2;
    for (let i = 0; i < 3; i += 1) stepped = approach(stepped, -1, 30, 80);
    expect(stepped).toBeCloseTo(approach(2, -1, 90, 80), 12);
    // Closer every step, from either side, and never across.
    let value = 0;
    for (let i = 0; i < 200; i += 1) {
      const next = approach(value, 1, 16, 110);
      expect(next).toBeGreaterThan(value);
      expect(next).toBeLessThanOrEqual(1);
      value = next;
    }
    expect(value).toBeGreaterThan(0.999);
    expect(approach(5, 1, 1e6, 110)).toBeCloseTo(1, 9);
  });
});

describe("the boulder scene, when the call is to hold a week", () => {
  test("the visitor's answer decides the rest of that loop and nothing else", () => {
    const made = holdTime(0);
    expect(branchAt(made - 1, 0, "hold")).toBe("ship");
    expect(branchAt(made, 1, "hold")).toBe("hold");
    expect(branchAt((AUTO_LOOPS + 1) * LOOP_MS - 1, 1, "hold")).toBe("hold");
    expect(branchAt((AUTO_LOOPS + 1) * LOOP_MS, 1, "hold")).toBe("ship");
    expect(branchAt(made + 2 * LOOP_MS, 1, "hold")).toBe("ship");
    // The next loop's call is its own: held again, it is that loop's that rolls back.
    expect(branchAt(holdTime(1) + 10, 2, "hold")).toBe("hold");
    expect(branchAt(holdTime(1) - 10, 1, "hold")).toBe("ship");
    expect(branchAt(made + 10, 1, "ship")).toBe("ship");
    // Before the tap the two ways are the same loop.
    expect(scoreAt(HOLD_AT, undefined, "hold")).toEqual(scoreAt(HOLD_AT));
  });

  test("its frames depend on where the loop is and nothing before it", () => {
    const first = stage();
    const moments = [0.55, 0.58, 0.6, 0.65, 0.7, 0.75, 0.85, 0.95];
    const sequence = moments.map((p) => first.frame(p, "hold"));
    const other = stage();
    for (const p of [0.3, 0.62, 0.99]) other.frame(p);
    [...moments.keys()].reverse().forEach((index) => expect(apart(other.frame(moments[index]!, "hold").crew, sequence[index]!.crew)).toBeLessThan(1e-9));
    const person = stick();
    const poses = moments.map((p) => person.at(p, undefined, "hold"));
    [...moments.keys()].reverse().forEach((index) => expect(apart(person.at(moments[index]!, undefined, "hold"), poses[index])).toBeLessThan(1e-9));
  });

  test("the boulder rolls back down, gathering speed, and nobody is in its way", () => {
    const { frame } = stage();
    let last = Infinity;
    let pace = 0;
    for (let p = HOLD_AT; p < 1; p += 0.0025) {
      const { boulder, crew, score } = frame(p, "hold");
      expect(score.gone).toBe(0);
      expect(score.charge).toBe(0);
      // Never back up the hill, and faster as it goes.
      expect(score.x).toBeLessThanOrEqual(last + 1e-9);
      if (p > ROLLBACK.go + 0.01 && p < ROLLBACK.left - 0.01) {
        expect(last - score.x).toBeGreaterThanOrEqual(pace - 1e-9);
        pace = last - score.x;
      }
      last = score.x;
      // Its turn is the ground it covers: it rolls, both ways.
      expect(score.travelled).toBeCloseTo(frame(p, "hold").score.travelled, 9);
      for (const bot of crew) {
        expect(distance(bot.feet, boulder)).toBeGreaterThan(BOULDER_R * 1.25);
        expect(distance(bot.tip, boulder)).toBeGreaterThan(BOULDER_R * 1.04);
      }
      crew.forEach((bot, index) => index > 0 && expect(distance(crew[index - 1]!.feet, bot.feet)).toBeGreaterThan(0.5 * bot.scale));
    }
  });

  test("it ends as it began: the boulder gone down out of the frame, the crew after it, its light out", () => {
    const { frame } = stage();
    for (const p of [0.9, 0.9995]) {
      const { boulder, score } = frame(p, "hold");
      expect(boulder[0]! + BOULDER_R).toBeLessThan(-7.2);
      expect(score.fading).toBe(0);
    }
    const { crew } = frame(0.9995, "hold");
    for (const bot of crew) expect(bot.feet[0]!).toBeLessThan(-7.6);
    // The crew follows the boulder: it is past each of them before they set off.
    const start = frame(BEATS.descend, "hold");
    for (const bot of start.crew) expect(start.boulder[0]!).toBeLessThan(bot.feet[0]! - BOULDER_R);
  });
});

describe("the boulder scene's boulders, one to a loop", () => {
  const loops = [1, 2, 3, 4, 5, 6, 7, 8];

  test("a loop's boulder is a matter of its number: a little larger or smaller, another stone, warmer or cooler", () => {
    expect(boulderOf(1)).toEqual({ pattern: 0, radius: BOULDER_R, warmth: 0 });
    for (const loop of loops) {
      const boulder = boulderOf(loop);
      expect(boulder).toEqual(boulderOf(loop));
      expect(boulder).toEqual(scoreAt(0.3, undefined, "ship", loop).boulder);
      expect(Math.abs(boulder.radius / BOULDER_R - 1)).toBeLessThanOrEqual(0.12);
      expect(boulder.pattern).toBeLessThan(BOULDER_PATTERNS);
      expect(Math.abs(boulder.warmth)).toBeLessThanOrEqual(1);
      // Never the same boulder twice running.
      expect(boulderOf(loop + 1)).not.toEqual(boulder);
    }
    expect(new Set(loops.map((loop) => boulderOf(loop).radius)).size).toBeGreaterThan(3);
    expect(new Set(loops.map((loop) => boulderOf(loop).pattern)).size).toBe(BOULDER_PATTERNS);
    // The stones differ in where they are dented.
    const dents = [0, 1, 2].map((pattern) => [0.1, 0.9, 1.7, 2.6].map((angle) => stoneAt(Math.cos(angle), 0.3, Math.sin(angle), false, pattern).dent));
    expect(apart(dents[0], dents[1])).toBeGreaterThan(0.005);
    expect(apart(dents[1], dents[2])).toBeGreaterThan(0.005);
  });

  test("whatever its size, the lead's hands are on its surface and nobody is inside it, pushed or rolling back", () => {
    const { frame } = stage();
    for (const loop of loops) {
      const { radius, pattern } = boulderOf(loop);
      for (let p = 0; p <= BEATS.top - 0.01; p += 0.012) {
        const { boulder, crew, score } = frame(p, "ship", loop);
        // It sits on the path: its centre is its own radius above the ground, near enough.
        expect(score.boulder.radius).toBe(radius);
        crew.forEach((bot, index) => {
          expect(distance(bot.feet, boulder)).toBeGreaterThan(radius * 1.1);
          expect(distance(bot.tip, boulder)).toBeGreaterThan(radius * 1.06);
          for (const side of [0, 1]) {
            expect(distance(bot.wrists[side]!, bot.shoulders[side]!)).toBeLessThan(0.47 * bot.scale);
            if (index > 0) continue;
            // A palm off this stone's own surface, dents and all.
            expect(Math.abs(distance(bot.wrists[side]!, boulder) - radius - PALM * bot.scale)).toBeLessThan(radius * 0.07);
            expect(distance(bot.shoulders[side]!, boulder)).toBeGreaterThan(radius * 1.18);
          }
          if (index > 0) expect(distance(crew[index - 1]!.feet, bot.feet)).toBeGreaterThan(0.5 * bot.scale);
        });
      }
      // Stood back at the top, and through both endings.
      for (const branch of ["ship", "hold"] as const) {
        for (let p = BEATS.top; p < 1; p += 0.004) {
          const { boulder, crew, score } = frame(p, branch, loop);
          if (score.gone > 0) continue;
          for (const bot of crew) {
            expect(distance(bot.feet, boulder)).toBeGreaterThan(radius * 1.25);
            expect(distance(bot.tip, boulder)).toBeGreaterThan(radius * 1.04);
          }
        }
        const end = frame(0.9995, branch, loop);
        if (branch === "hold") expect(end.boulder[0]! + radius).toBeLessThan(-7.2);
        for (const bot of end.crew) expect(bot.feet[0]!).toBeLessThan(-7.6);
      }
      // The stone under the lead's hands is this loop's, not the first's.
      expect(pattern).toBe(boulderOf(loop).pattern);
    }
  });

  test("the same loop is the same frame, whatever loops came before", () => {
    const first = stage();
    const frames = loops.map((loop) => first.frame(0.3, "ship", loop));
    const other = stage();
    [...loops].reverse().forEach((loop) => expect(apart(other.frame(0.3, "ship", loop), frames[loop - 1])).toBeLessThan(1e-9));
    // And the boulder turns as far as it has rolled, for its size.
    const [small, large] = [first.frame(0.3, "ship", 3).score, first.frame(0.3, "ship", 2).score];
    expect(small.travelled).toBe(large.travelled);
    expect(small.boulder.radius).toBeLessThan(large.boulder.radius);
  });
});

describe("the boulder scene's crew, looking where the visitor points while it waits", () => {
  /** A point on the figure (fractions across and down it), as the scene turns it into one in the world. */
  const pointed = (x: number, y: number) => new Vector3(...pointOn(15 / 8, 0, x, y, LOOK_PLANE));

  test("a point on the figure is a point in the world that shows there", () => {
    for (const [x, y] of [[0.1, 0.2], [0.5, 0.5], [0.85, 0.7], [0.3, 0.95]] as const) {
      const [u, v] = project(...pointOn(15 / 8, 0, x, y, LOOK_PLANE));
      expect(u).toBeCloseTo(x, 9);
      expect(v).toBeCloseTo(y, 9);
    }
  });

  test("each head turns towards the point, as far as a neck allows, and by as much as it attends", () => {
    const { frame } = stage();
    const idle = frame(HOLD_AT);
    for (const [x, y] of [[0.75, 0.3], [0.62, 0.75], [0.9, 0.55], [0.55, 0.15], [0.05, 0.5], [0.5, 1.4]] as const) {
      const point = pointed(x, y);
      const looking = frame(HOLD_AT, "ship", 1, { point, weight: 1 });
      const half = frame(HOLD_AT, "ship", 1, { point, weight: 0.5 });
      looking.crew.forEach((bot, index) => {
        const to = point.clone().sub(new Vector3(...bot.eyes)).normalize();
        const before = to.angleTo(new Vector3(...idle.crew[index]!.sight));
        const after = to.angleTo(new Vector3(...bot.sight));
        const between = to.angleTo(new Vector3(...half.crew[index]!.sight));
        // Nearer the point than it was (or as near as the neck goes), and halfway there at half attention.
        expect(after).toBeLessThanOrEqual(before + 1e-9);
        expect(between).toBeLessThanOrEqual(before + 1e-9);
        expect(between).toBeGreaterThanOrEqual(after - 1e-9);
        // Where the neck can reach it, it looks right at it.
        const reach = bot.gaze;
        if (Math.abs(reach.turn) < 1.2 && reach.tilt < 0.7 && reach.tilt > -0.35) expect(after).toBeLessThan(0.2);
        // Nothing but the head moves: feet and shoulders are where they were.
        expect(apart(bot.feet, idle.crew[index]!.feet)).toBeLessThan(1e-9);
        expect(apart(bot.shoulders, idle.crew[index]!.shoulders)).toBeLessThan(1e-9);
      });
    }
  });

  test("it is a matter of the pose and the point: the same in any order, and nothing lingers when the point is gone", () => {
    const { frame } = stage();
    const point = pointed(0.8, 0.3);
    const once = frame(HOLD_AT, "ship", 1, { point, weight: 0.7 });
    const idle = frame(HOLD_AT);
    frame(0.3, "ship", 2, { point: pointed(0.2, 0.8), weight: 1 });
    expect(apart(frame(HOLD_AT, "ship", 1, { point, weight: 0.7 }).crew, once.crew)).toBeLessThan(1e-9);
    expect(apart(frame(HOLD_AT).crew, idle.crew)).toBeLessThan(1e-9);
    const sights = (crew: typeof idle.crew) => crew.map((bot) => [bot.sight, bot.feet, bot.tip]);
    expect(apart(sights(frame(HOLD_AT, "ship", 1, { point, weight: 0 }).crew), sights(idle.crew))).toBeLessThan(1e-9);
  });
});
