import { MeshBasicMaterial, Object3D, Quaternion, Vector3 } from "three";
import { describe, expect, test } from "vitest";

import { AVATAR_BONES, makeAvatar, type AvatarBone, type AvatarPose } from "@/components/marketing/hill/avatar";
import { makeBot, makeBotKit, PALM, type BotMaterials } from "@/components/marketing/hill/bot";
import { BEATS, BOULDER_R, CREW, placeBoulder, placeCrew, scoreAt, type Member } from "@/components/marketing/hill/crew";
import { AUTO_LOOPS, HOLD_AT, holdTime, LOOP_MS, momentAt } from "@/components/marketing/hill/timeline";

/** The landing page's boulder scene, without a renderer: the same bots, placed by the same score. */
function stage() {
  const kit = makeBotKit();
  const material = new MeshBasicMaterial();
  const materials: BotMaterials = { shell: material, dark: material, trim: material, visor: material, eye: material, tip: material };
  const crew: Member[] = CREW.map((look) => ({ ...look, bot: makeBot(kit, materials, look), hands: [new Vector3(), new Vector3()] as const }));
  const centre = new Vector3();
  const turned = new Quaternion();
  /** Draws one frame and says where everything ended up. */
  function frame(progress: number) {
    const score = scoreAt(progress);
    placeBoulder(score, centre, turned);
    placeCrew(score, crew, centre, turned);
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
        };
      }),
    };
  }
  return { frame };
}

/** The largest difference between two snapshots' numbers. */
function apart(a: unknown, b: unknown): number {
  const numbers = (value: unknown): number[] => (typeof value === "number" ? [value] : Array.isArray(value) ? value.flatMap(numbers) : Object.values(value as object).flatMap(numbers));
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
  const chest = bone("chest", bone("spine", bone("hips", model, 0, 0.9, 0), 0, 0.1, 0), 0, 0.15, 0);
  bone("head", bone("neck", chest, 0, 0.25, 0), 0, 0.08, 0);
  for (const [side, sign] of [["right", 1], ["left", -1]] as const) {
    bone(`${side}Hand`, bone(`${side}LowerArm`, bone(`${side}UpperArm`, chest, 0.16 * sign, 0.2, 0), 0.24 * sign, 0, 0), 0.22 * sign, 0, 0);
  }
  const phone = new Object3D();
  const avatar = makeAvatar({ root, bones, faces: [], phone });
  const snapshot = () => {
    root.updateMatrixWorld(true);
    return Object.values(bones).flatMap((b) => [...b.quaternion.toArray(), ...b.getWorldPosition(new Vector3()).toArray()]).concat(phone.position.toArray());
  };
  const at = (progress: number, idle?: number) => {
    const score = scoreAt(progress, idle);
    const pose: AvatarPose = { seconds: score.seconds, read: score.read, tap: score.tap, show: score.show, smile: score.smile, joy: score.joy, blink: false, watch: new Vector3(-3 + 5 * score.p, 1, 0) };
    avatar.pose(pose);
    return snapshot();
  };
  return { at, bones, root };
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
});

describe("the boulder scene's clock", () => {
  test("three loops play through; the fourth stops at the question", () => {
    expect(HOLD_AT).toBeGreaterThan(BEATS.top + 0.05); // the card is up
    expect(HOLD_AT).toBeLessThan(BEATS.tap - 0.02); // and nothing is tapped
    for (let loop = 0; loop < AUTO_LOOPS; loop += 1) {
      // Through the decision point of each of the first three, untouched.
      for (const p of [0, 0.3, HOLD_AT, BEATS.tap, 0.8, 0.999]) {
        const moment = momentAt((loop + p) * LOOP_MS, 0);
        expect(moment.held).toBe(false);
        expect(moment.loop).toBe(loop + 1);
        expect(moment.progress).toBeCloseTo(p, 9);
      }
    }
    expect(momentAt((AUTO_LOOPS + HOLD_AT) * LOOP_MS - 1, 0).held).toBe(false);
    const held = momentAt((AUTO_LOOPS + HOLD_AT) * LOOP_MS, 0);
    expect(held).toMatchObject({ held: true, loop: AUTO_LOOPS + 1 });
    expect(held.progress).toBeCloseTo(HOLD_AT, 9);
  });

  test("a clock that ran on unseen is still at the hold: no loop is skipped and none is counted twice", () => {
    for (const late of [1, 500, LOOP_MS * 0.6, LOOP_MS * 7.3]) {
      const moment = momentAt(holdTime(0) + late, 0);
      expect(moment).toMatchObject({ held: true, time: holdTime(0), loop: AUTO_LOOPS + 1 });
      expect(moment.progress).toBeCloseTo(HOLD_AT, 9);
    }
    expect(momentAt(-50, 0)).toMatchObject({ time: 0, progress: 0, loop: 1, held: false });
  });

  test("the call made, it goes on from there, and asks again three loops later", () => {
    const from = holdTime(0);
    // The moment after the answer is the moment before it: nothing jumps.
    expect(momentAt(from, 1)).toMatchObject({ held: false, time: from, loop: AUTO_LOOPS + 1 });
    expect(momentAt(from, 1).progress).toBeCloseTo(HOLD_AT, 9);
    // The rest of that loop, then three whole ones, all untouched.
    expect(holdTime(1) - from).toBe((AUTO_LOOPS + 1) * LOOP_MS);
    for (let elapsed = from; elapsed < holdTime(1); elapsed += LOOP_MS / 7) expect(momentAt(elapsed, 1).held).toBe(false);
    expect(momentAt(holdTime(1), 1)).toMatchObject({ held: true, loop: 2 * (AUTO_LOOPS + 1) });
    expect(momentAt(holdTime(1) + LOOP_MS * 3, 1).time).toBe(holdTime(1));
    expect(momentAt(holdTime(1), 2).held).toBe(false);
  });
});
