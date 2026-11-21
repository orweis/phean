// node --test scripts/check-manifest.test.mjs: the checker passes the app's manifest and fails each
// way the checklist can be broken.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { checkManifest, checkProject } from "./check-manifest.mjs";

// The Android project: this script's parent (apps/android/scripts), or android/ beside scripts/.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = [path.resolve(HERE, ".."), path.resolve(HERE, "../android")].find((dir) => existsSync(path.join(dir, "app/src/main/AndroidManifest.xml")));
const SOURCE = readFileSync(path.join(PROJECT, "app/src/main/AndroidManifest.xml"), "utf8");
const NETWORK = readFileSync(path.join(PROJECT, "app/src/main/res/xml/network_security_config.xml"), "utf8");

const check = (xml, options = {}) => checkManifest(xml, { networkConfig: NETWORK, ...options });
const swap = (from, to) => {
  assert.ok(SOURCE.includes(from), `the manifest contains ${from}`);
  return SOURCE.replace(from, to);
};

test("the app's manifest and project pass", () => {
  assert.deepEqual(check(SOURCE), []);
  assert.deepEqual(checkProject(PROJECT), []);
});

test("a third exported component fails, including one a library adds", () => {
  const extra = '<receiver android:name="androidx.profileinstaller.ProfileInstallReceiver" android:exported="true" android:permission="android.permission.DUMP" />';
  assert.match(check(SOURCE.replace("</application>", `${extra}</application>`)).join(), /ProfileInstallReceiver is exported/);
  assert.match(check(swap('android:name="com.google.androidbrowserhelper.trusted.FocusActivity"\n            android:exported="false"', 'android:name="com.google.androidbrowserhelper.trusted.FocusActivity"\n            android:exported="true"')).join(), /FocusActivity is exported/);
});

test("an exported value that is not a literal fails", () => {
  assert.match(check(swap('android:enabled="true"\n            android:exported="true"', 'android:enabled="true"\n            android:exported="@bool/enableNotification"')).join(), /literal/);
});

test("a missing DelegationService fails, since notifications would silently not be delegated", () => {
  assert.match(check(SOURCE.replace(/<service[\s\S]*?<\/service>/, "")).join(), /DelegationService must be exported/);
});

test("another permission fails", () => {
  assert.match(check(SOURCE.replace("<application", '<uses-permission android:name="android.permission.CAMERA" />\n<application')).join(), /Permissions must be exactly/);
});

test("cleartext, backups, a WebView fallback and wide App Links fail", () => {
  assert.match(check(swap('android:usesCleartextTraffic="false"', 'android:usesCleartextTraffic="true"')).join(), /usesCleartextTraffic/);
  assert.match(check(SOURCE, { networkConfig: NETWORK.replace('"false"', '"true"') }).join(), /cleartext/);
  assert.match(check(swap('android:allowBackup="false"', 'android:allowBackup="true"')).join(), /allowBackup/);
  assert.match(check(swap('android:value="customtabs"', 'android:value="webview"')).join(), /customtabs/);
  assert.match(check(swap('android:pathPrefix="/w/"', 'android:pathPrefix="/"')).join(), /\/w\/ only/);
  assert.match(check(swap('android:scheme="https"', 'android:scheme="http"')).join(), /https only/);
  assert.match(check(swap('<intent-filter android:autoVerify="true">', "<intent-filter>")).join(), /autoVerify/);
  assert.match(check(SOURCE, { host: "phean.example" }).join(), /must be for phean.example/);
});

test("a removed element does not count", () => {
  assert.deepEqual(check(SOURCE.replace("</application>", '<receiver android:name="x.Exported" android:exported="true" tools:node="remove" /></application>')), []);
});
