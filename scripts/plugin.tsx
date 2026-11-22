/**
 * Builds the parts of the Claude plugin (`plugin/`) that come from elsewhere in the repository:
 *
 * - `plugin/skills/`, a copy of `skills/` (the source of truth; the directory refuses symlinks, and a
 *   plugin may load nothing outside its own folder);
 * - `plugin/LICENSE`, a copy of the repository's;
 * - `plugin/assets/icon.png` and `public/phean-icon.png`, the brand mark on its dusk tile at 512px.
 *
 * `tests/plugin.test.ts` fails when the copies drift, so run `pnpm plugin` after changing a skill.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ImageResponse } from "next/og";

import { BrandTile } from "../src/components/brand-tile";

const root = path.resolve(import.meta.dirname, "..");
const at = (...parts: string[]) => path.join(root, ...parts);
export const ICON_SIZE = 512;

rmSync(at("plugin", "skills"), { recursive: true, force: true });
cpSync(at("skills"), at("plugin", "skills"), { recursive: true });
cpSync(at("LICENSE"), at("plugin", "LICENSE"));

const icon = Buffer.from(await new ImageResponse(<BrandTile size={ICON_SIZE} />, { width: ICON_SIZE, height: ICON_SIZE }).arrayBuffer());
mkdirSync(at("plugin", "assets"), { recursive: true });
writeFileSync(at("plugin", "assets", "icon.png"), icon);
writeFileSync(at("public", "phean-icon.png"), icon);

console.log("Wrote plugin/skills, plugin/LICENSE, plugin/assets/icon.png and public/phean-icon.png");
