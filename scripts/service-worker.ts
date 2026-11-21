/** Writes `public/sw.js` from `src/lib/service-worker.ts` and `src/lib/push.ts`. */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { bundleServiceWorker } from "./service-worker-bundle";

const target = path.resolve(import.meta.dirname, "../public/sw.js");
writeFileSync(target, bundleServiceWorker());
console.log(`Wrote ${path.relative(process.cwd(), target)}`);
