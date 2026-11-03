import "./env";

import { migrateDatabase } from "../src/server/db/migrate";
import { resolveDatabaseUrl } from "../src/server/db/url";

const url = resolveDatabaseUrl();
const target = url.startsWith("pglite:") ? url : url.replace(/\/\/[^@]*@/, "//***@");

console.log(`Applying migrations to ${target}`);
await migrateDatabase(url);
console.log("Migrations applied");
