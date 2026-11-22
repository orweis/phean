import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { routes } from "@/lib/routes";
import { isDocSlug, loadDoc } from "@/server/docs";
import { TOOLS } from "@/server/mcp/tools";

/*
 * The Claude plugin in `plugin/`: what Anthropic's directory checks before a submission, and that its
 * copies of the skills and the licence are the repository's own (`pnpm plugin` writes them).
 * CI also runs `claude plugin validate plugin --strict --profile directory`.
 */

const ROOT = process.cwd();
const PLUGIN = join(ROOT, "plugin");
const json = (path: string) => JSON.parse(readFileSync(join(PLUGIN, path), "utf8"));
const manifest = json(".claude-plugin/plugin.json");
const marketplace = json(".claude-plugin/marketplace.json");
const servers = json(".mcp.json").mcpServers as Record<string, { type: string; url: string }>;

/** Every file under a folder, as paths relative to it. */
const filesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesIn(path).map((file) => join(entry.name, file)) : [entry.name];
  });

const IMAGE = /\.(png|jpe?g|gif|webp)$/;
const PHEAN = "https://phean.ai";

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(bytes: Buffer) {
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("the plugin's copies", () => {
  it("carries every skill exactly as skills/ has it, and nothing else", () => {
    const source = filesIn(join(ROOT, "skills")).sort();
    expect(filesIn(join(PLUGIN, "skills")).sort()).toEqual(source);
    for (const file of source) {
      expect(readFileSync(join(PLUGIN, "skills", file), "utf8"), `${file} drifted: run pnpm plugin`).toBe(readFileSync(join(ROOT, "skills", file), "utf8"));
    }
  });

  it("carries the repository's licence", () => {
    expect(readFileSync(join(PLUGIN, "LICENSE"), "utf8")).toBe(readFileSync(join(ROOT, "LICENSE"), "utf8"));
  });

  it("serves the same square icon on the site as it ships", () => {
    const icon = readFileSync(join(PLUGIN, manifest.icon));
    expect(readFileSync(join(ROOT, "public", "phean-icon.png")).equals(icon)).toBe(true);
    const { width, height } = pngSize(icon);
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(512);
  });
});

describe("the plugin manifest", () => {
  it("has a name the directory accepts and the metadata it asks for", () => {
    expect(manifest.name).toBe("phean");
    expect(manifest.name).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/);
    expect(manifest.displayName).toBe("Phean");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.description.length).toBeGreaterThan(50);
    expect(manifest.author.name).toBeTruthy();
    expect(manifest.license).toBe("MIT");
    expect(manifest.keywords.length).toBeGreaterThan(0);
    expect(manifest.icon).toMatch(/^\.\/[^.]/);
  });

  it("points every link at a page phean.ai has", () => {
    expect(manifest.homepage).toBe(PHEAN);
    expect(manifest.repository).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
    const path = (url: string) => {
      expect(url.startsWith(`${PHEAN}/`), url).toBe(true);
      return url.slice(PHEAN.length);
    };
    const docs = /^\/docs\/([a-z-]+)$/.exec(path(manifest.documentationUrl))?.[1];
    expect(docs && isDocSlug(docs)).toBe(true);
    expect(path(manifest.supportUrl)).toBe(routes.support());
    expect(path(manifest.privacyPolicyUrl)).toBe(routes.privacy());
    expect(path(manifest.termsOfServiceUrl)).toBe(routes.terms());
  });

  it("lists itself in its marketplace at the same version", () => {
    expect(marketplace.name).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    expect(marketplace.owner.name).toBeTruthy();
    expect(marketplace.plugins).toEqual([expect.objectContaining({ name: manifest.name, source: "./", version: manifest.version })]);
  });

  it("connects to Phean's one MCP endpoint over HTTPS, with no secrets", () => {
    expect(servers).toEqual({ phean: { type: "http", url: `${PHEAN}${routes.mcp()}` } });
  });
});

describe("the plugin folder", () => {
  const files = filesIn(PLUGIN);

  it("holds only regular files, text under 256 KiB apart from images", () => {
    for (const file of files) {
      const stat = lstatSync(join(PLUGIN, file));
      expect(stat.isFile(), `${file} is not a regular file`).toBe(true);
      if (!IMAGE.test(file)) expect(stat.size, file).toBeLessThan(256 * 1024);
    }
    expect(files.filter((file) => /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/.test(file))).toEqual([]);
  });

  it("has a README of at least 40 words outside code that names every host it talks to", () => {
    const readme = readFileSync(join(PLUGIN, "README.md"), "utf8");
    const prose = readme.replace(/```[\s\S]*?```/g, "");
    expect(prose.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40);
    for (const server of Object.values(servers)) expect(readme).toContain(server.url);
    for (const skill of readdirSync(join(PLUGIN, "skills"))) expect(readme).toContain(`/${manifest.name}:${skill}`);
  });

  it("is documented with the commands that install it", async () => {
    const page = await loadDoc("claude-plugin");
    const repo = relative("https://github.com", manifest.repository);
    for (const text of [`marketplace add ${repo}`, `install ${manifest.name}@${marketplace.name}`, `plugin:${manifest.name}:phean`]) {
      expect(page.body, text).toContain(text);
      expect(readFileSync(join(PLUGIN, "README.md"), "utf8"), text).toContain(text);
    }
    for (const skill of readdirSync(join(PLUGIN, "skills"))) expect(page.body).toContain(`/${manifest.name}:${skill}`);
  });
});

describe("the connector, against the directory's tool rules", () => {
  it("titles and annotates every tool, with names of 64 characters at most", () => {
    for (const tool of TOOLS) {
      expect(tool.name.length, tool.name).toBeLessThanOrEqual(64);
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.annotations.title, tool.name).toBe(tool.title);
      expect(typeof tool.annotations.readOnlyHint, tool.name).toBe("boolean");
      expect(typeof tool.annotations.destructiveHint, tool.name).toBe("boolean");
      expect(tool.annotations.readOnlyHint && tool.annotations.destructiveHint, tool.name).toBe(false);
    }
  });
});
