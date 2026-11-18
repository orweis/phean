/** Writes `src/app/themes.css` from the theme tokens in `src/lib/theme-tokens.ts`. */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { renderThemeCss } from "../src/lib/theme-css";

const target = path.resolve(import.meta.dirname, "../src/app/themes.css");
writeFileSync(target, renderThemeCss());
console.log(`Wrote ${path.relative(process.cwd(), target)}`);
