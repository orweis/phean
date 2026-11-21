import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/.well-known/assetlinks.json/route";
import { androidAppLinks } from "@/server/config";

const PLAY = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";
const UPLOAD = "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";

async function statements() {
  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^application\/json/);
  return response.json();
}

describe("/.well-known/assetlinks.json", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is an empty list while no fingerprint is configured", async () => {
    vi.stubEnv("PHEAN_ANDROID_CERT_SHA256", "");
    expect(await statements()).toEqual([]);
  });

  it("lets app.phean, signed with the listed keys, handle every link", async () => {
    vi.stubEnv("PHEAN_ANDROID_CERT_SHA256", `${PLAY}, ${UPLOAD.toLowerCase()}`);
    expect(await statements()).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: "app.phean", sha256_cert_fingerprints: [PLAY, UPLOAD] },
      },
    ]);
  });

  it("names the package the environment gives", async () => {
    vi.stubEnv("PHEAN_ANDROID_CERT_SHA256", PLAY);
    vi.stubEnv("PHEAN_ANDROID_PACKAGE", "app.phean.preview");
    expect(androidAppLinks()).toEqual({ packageName: "app.phean.preview", fingerprints: [PLAY] });
  });

  it("refuses malformed fingerprints and packages instead of trusting them", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("PHEAN_ANDROID_CERT_SHA256", `${PLAY},AA:BB,${PLAY.replaceAll(":", "")},not-a-key`);
    expect(androidAppLinks()?.fingerprints).toEqual([PLAY]);
    vi.stubEnv("PHEAN_ANDROID_CERT_SHA256", "AA:BB");
    expect(await statements()).toEqual([]);
    vi.stubEnv("PHEAN_ANDROID_CERT_SHA256", PLAY);
    vi.stubEnv("PHEAN_ANDROID_PACKAGE", "app phean\"}]");
    expect(await statements()).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });
});
