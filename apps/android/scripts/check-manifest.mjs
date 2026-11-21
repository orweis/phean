#!/usr/bin/env node
/**
 * Checks the Android app's manifest against the security checklist (docs/apps/PLAN.md §4, "Android"):
 *
 * - the only exported components are the launcher activity (`LauncherActivity`, MAIN/LAUNCHER) and
 *   `DelegationService` (TRUSTED_WEB_ACTIVITY_SERVICE), and every `exported` is a literal;
 * - the only permissions are INTERNET and POST_NOTIFICATIONS;
 * - cleartext traffic is off, in the manifest and in the network security config;
 * - backups are off;
 * - there is no WebView: the fallback is Custom Tabs and no WebView fallback activity is declared;
 * - App Links are verified, https only, for /w/ only.
 *
 * Run it on the source manifest and on the merged one (libraries add components and permissions):
 *
 *   node scripts/check-manifest.mjs [AndroidManifest.xml] [--res app/src/main/res] [--host phean.example]
 *
 * With no path it checks the app's source manifest. Plain Node, no dependencies.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const LAUNCHER = "LauncherActivity";
const DELEGATION = "DelegationService";
const PERMISSIONS = ["android.permission.INTERNET", "android.permission.POST_NOTIFICATIONS"];
const COMPONENTS = ["activity", "activity-alias", "service", "receiver", "provider"];

/** A small XML reader: elements with attributes and children, comments and declarations dropped. */
export function parseXml(text) {
  const root = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  const source = text.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  for (let match; (match = tag.exec(source)); ) {
    const [, closing, name, rawAttrs, selfClosing] = match;
    if (closing) {
      const open = stack.pop();
      if (open?.name !== name) throw new Error(`Malformed XML: </${name}> closes <${open?.name}>`);
      continue;
    }
    const attrs = {};
    for (const [, key, double, single] of rawAttrs.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[key] = double ?? single;
    const element = { name, attrs, children: [] };
    stack.at(-1).children.push(element);
    if (!selfClosing) stack.push(element);
  }
  if (stack.length !== 1) throw new Error(`Malformed XML: <${stack.at(-1).name}> is never closed`);
  return root;
}

const removed = (element) => element.attrs["tools:node"] === "remove";
const live = (elements) => elements.filter((element) => !removed(element));
const childrenNamed = (element, name) => live(element.children.filter((child) => child.name === name));
const named = (element) => element.attrs["android:name"] ?? "";
const shortName = (element) => named(element).split(".").at(-1);

function filterActions(filter) {
  return {
    actions: childrenNamed(filter, "action").map(named),
    categories: childrenNamed(filter, "category").map(named),
    data: childrenNamed(filter, "data"),
  };
}

/** Every rule this file breaks, as sentences; empty when it passes. */
export function checkManifest(xml, { networkConfig = null, host = null } = {}) {
  const problems = [];
  const manifest = parseXml(xml).children.find((element) => element.name === "manifest");
  if (!manifest) return ["There is no <manifest> element."];
  const application = childrenNamed(manifest, "application")[0];
  if (!application) return ["There is no <application> element."];

  // Permissions: exactly the two.
  const permissions = [...childrenNamed(manifest, "uses-permission"), ...childrenNamed(manifest, "uses-permission-sdk-23")].map(named).sort();
  if (JSON.stringify(permissions) !== JSON.stringify([...PERMISSIONS].sort())) {
    problems.push(`Permissions must be exactly ${PERMISSIONS.join(" and ")}, not ${permissions.join(", ") || "none"}.`);
  }

  // Cleartext and backups.
  if (application.attrs["android:usesCleartextTraffic"] !== "false") problems.push('<application> must set android:usesCleartextTraffic="false".');
  if (application.attrs["android:allowBackup"] !== "false") problems.push('<application> must set android:allowBackup="false".');
  const configRef = application.attrs["android:networkSecurityConfig"];
  if (!configRef) problems.push("<application> must name a network security config.");
  if (networkConfig !== null) {
    if (!/<base-config\b[^>]*cleartextTrafficPermitted="false"/.test(networkConfig)) problems.push('The network security config\'s <base-config> must set cleartextTrafficPermitted="false".');
    if (/cleartextTrafficPermitted="true"/.test(networkConfig)) problems.push("The network security config permits cleartext somewhere.");
  }

  // Exported components: exactly the launcher and the delegation service.
  const exported = [];
  for (const component of COMPONENTS.flatMap((kind) => childrenNamed(application, kind).map((element) => ({ kind, element })))) {
    const value = component.element.attrs["android:exported"];
    const filters = childrenNamed(component.element, "intent-filter");
    if (value === undefined && filters.length) problems.push(`${component.kind} ${named(component.element)} has an intent filter, so it must say android:exported explicitly.`);
    if (value !== undefined && value !== "true" && value !== "false") problems.push(`${component.kind} ${named(component.element)} must set android:exported to a literal true or false, not ${value}.`);
    if (value === "true" || (value === undefined && filters.length)) exported.push({ ...component, filters: filters.map(filterActions) });
  }
  const launcher = exported.find(({ kind, element }) => kind === "activity" && shortName(element) === LAUNCHER);
  const delegation = exported.find(({ kind, element }) => kind === "service" && shortName(element) === DELEGATION);
  const others = exported.filter((component) => component !== launcher && component !== delegation);
  if (!launcher) problems.push(`The launcher activity (${LAUNCHER}) must be exported.`);
  if (!delegation) problems.push(`${DELEGATION} must be exported, or Chrome cannot delegate notifications to the app.`);
  for (const { kind, element } of others) problems.push(`${kind} ${named(element)} is exported; only ${LAUNCHER} and ${DELEGATION} may be.`);
  if (launcher && !launcher.filters.some(({ actions, categories }) => actions.includes("android.intent.action.MAIN") && categories.includes("android.intent.category.LAUNCHER"))) {
    problems.push(`${LAUNCHER} must be the MAIN/LAUNCHER activity.`);
  }
  if (delegation && !delegation.filters.some(({ actions }) => actions.includes("android.support.customtabs.trusted.TRUSTED_WEB_ACTIVITY_SERVICE"))) {
    problems.push(`${DELEGATION} must handle android.support.customtabs.trusted.TRUSTED_WEB_ACTIVITY_SERVICE.`);
  }

  // No WebView: Custom Tabs as the fallback, and no WebView fallback activity.
  const all = COMPONENTS.flatMap((kind) => childrenNamed(application, kind));
  if (all.some((element) => shortName(element) === "WebViewFallbackActivity")) problems.push("No WebView fallback activity may be declared.");
  const launcherElement = launcher?.element ?? childrenNamed(application, "activity").find((element) => shortName(element) === LAUNCHER);
  const fallback = launcherElement && childrenNamed(launcherElement, "meta-data").find((meta) => named(meta) === "android.support.customtabs.trusted.FALLBACK_STRATEGY");
  if (fallback?.attrs["android:value"] !== "customtabs") problems.push('The launcher\'s FALLBACK_STRATEGY must be "customtabs".');

  // App Links: verified, https only, /w/ only, on the expected host.
  for (const { filters } of exported) {
    for (const { actions, categories, data } of filters) {
      if (!actions.includes("android.intent.action.VIEW") || !categories.includes("android.intent.category.BROWSABLE")) continue;
      problems.push(...appLinkProblems(data, host));
    }
  }
  const viewFilters = launcher ? launcher.filters.filter(({ actions }) => actions.includes("android.intent.action.VIEW")) : [];
  const autoVerified = launcherElement ? childrenNamed(launcherElement, "intent-filter").filter((filter) => filter.attrs["android:autoVerify"] === "true") : [];
  if (viewFilters.length !== autoVerified.length || !autoVerified.length) problems.push('Every VIEW intent filter on the launcher must set android:autoVerify="true", and there must be one.');
  return problems;
}

function appLinkProblems(data, host) {
  const problems = [];
  if (!data.length) problems.push("An App Links intent filter must name its scheme, host and path.");
  for (const item of data) {
    const attrs = item.attrs;
    if (attrs["android:scheme"] !== undefined && attrs["android:scheme"] !== "https") problems.push(`App Links must be https only, not ${attrs["android:scheme"]}.`);
    if (attrs["android:pathPrefix"] !== undefined && attrs["android:pathPrefix"] !== "/w/") problems.push(`App Links must cover /w/ only, not ${attrs["android:pathPrefix"]}.`);
    for (const key of ["android:path", "android:pathPattern", "android:pathAdvancedPattern", "android:pathSuffix", "android:port"]) {
      if (attrs[key] !== undefined) problems.push(`App Links must not set ${key}.`);
    }
    if (host && attrs["android:host"] !== undefined && attrs["android:host"] !== host) problems.push(`App Links must be for ${host}, not ${attrs["android:host"]}.`);
  }
  const schemes = data.map((item) => item.attrs["android:scheme"]).filter(Boolean);
  const hosts = data.map((item) => item.attrs["android:host"]).filter(Boolean);
  const prefixes = data.map((item) => item.attrs["android:pathPrefix"]).filter(Boolean);
  if (!schemes.length || !hosts.length || !prefixes.length) problems.push("An App Links intent filter must set the https scheme, the host and pathPrefix /w/.");
  return problems;
}

/**
 * Keeps twa-manifest.json (for Bubblewrap's tools) in step with what the build really uses: the
 * host and version in gradle.properties, the package, and the colours in res/values/colors.xml.
 */
export function checkProject(projectDir) {
  const problems = [];
  const read = (file) => readFileSync(path.join(projectDir, file), "utf8");
  const twa = JSON.parse(read("twa-manifest.json"));
  const properties = Object.fromEntries(
    read("gradle.properties")
      .split("\n")
      .map((line) => /^\s*([\w.]+)\s*=\s*(.*?)\s*$/.exec(line))
      .filter(Boolean)
      .map(([, key, value]) => [key, value]),
  );
  const colors = Object.fromEntries([...read("app/src/main/res/values/colors.xml").matchAll(/<color name="(\w+)">(#[0-9A-Fa-f]+)<\/color>/g)].map(([, name, value]) => [name, value.toUpperCase()]));
  const [major, minor, patch] = (properties["phean.version"] ?? "").split(".").map(Number);
  const expected = {
    packageId: "app.phean",
    host: properties["phean.host"],
    startUrl: "/workspaces",
    fallbackType: "customtabs",
    enableNotifications: true,
    appVersionName: properties["phean.version"],
    appVersionCode: major * 10000 + minor * 100 + patch,
    themeColor: colors.paper,
    themeColorDark: colors.paperDark,
    navigationColor: colors.paper,
    navigationColorDark: colors.paperDark,
    backgroundColor: colors.paper,
  };
  for (const [key, value] of Object.entries(expected)) {
    const actual = typeof twa[key] === "string" ? twa[key].toUpperCase() : twa[key];
    if (actual !== (typeof value === "string" ? value.toUpperCase() : value)) problems.push(`twa-manifest.json's ${key} is ${JSON.stringify(twa[key])}, but the build uses ${JSON.stringify(value)}.`);
  }
  for (const key of ["iconUrl", "maskableIconUrl", "webManifestUrl", "fullScopeUrl"]) {
    if (twa[key] && new URL(twa[key]).host !== properties["phean.host"]) problems.push(`twa-manifest.json's ${key} is not on ${properties["phean.host"]}.`);
  }
  return problems;
}

function parseArgs(argv) {
  const options = { manifest: null, res: null, host: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--res") options.res = argv[++index];
    else if (arg === "--host") options.host = argv[++index];
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else options.manifest = arg;
  }
  return options;
}

/** The app's source manifest, beside this script (apps/android/scripts) or one level up (scripts/ beside android/). */
function defaultManifest() {
  const candidates = [path.join(HERE, "../app/src/main/AndroidManifest.xml"), path.join(HERE, "../android/app/src/main/AndroidManifest.xml")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(options.manifest ?? defaultManifest());
  const xml = readFileSync(manifestPath, "utf8");
  const resDir = options.res ? path.resolve(options.res) : path.join(path.dirname(manifestPath), "res");
  const configRef = /android:networkSecurityConfig="@xml\/([\w.]+)"/.exec(xml)?.[1];
  const configPath = configRef && path.join(resDir, "xml", `${configRef}.xml`);
  const networkConfig = configPath && existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
  const problems = checkManifest(xml, { networkConfig, host: options.host });
  if (configRef && networkConfig === null) problems.push(`The network security config ${configPath} could not be read (pass --res).`);
  // The source manifest sits at <project>/app/src/main; check the project's Bubblewrap file beside it.
  const projectDir = path.resolve(path.dirname(manifestPath), "../../..");
  if (manifestPath.endsWith(path.join("app", "src", "main", "AndroidManifest.xml")) && existsSync(path.join(projectDir, "twa-manifest.json"))) {
    problems.push(...checkProject(projectDir));
  }
  const label = path.relative(process.cwd(), manifestPath) || manifestPath;
  if (problems.length) {
    console.error(`${label} fails the manifest check:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`${label}: exported only ${LAUNCHER} and ${DELEGATION}; permissions ${PERMISSIONS.join(", ")}; cleartext and backups off; Custom Tabs fallback; App Links /w/ only.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
