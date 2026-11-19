import { MeshBasicMaterial, Quaternion, Vector3 } from "three";
import { describe, expect, test } from "vitest";

import { makeBot, makeBotKit, PALM, type BotMaterials } from "@/components/marketing/hill/bot";
import { BEATS, BOULDER_R, CREW, placeBoulder, placeCrew, scoreAt, type Member } from "@/components/marketing/hill/crew";

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
