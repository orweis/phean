import manifest from "../../../public/marketing/manifest.json";

import { cx } from "@/lib/cx";

/*
 * The site's illustrations (public/marketing, listed with their alt text in manifest.json), each
 * pre-encoded as AVIF and WebP at a few widths. A <picture> serves them as they are, with the width
 * and height of the largest file so the page never shifts as one arrives. Below the fold they load
 * lazily; the hero asks for high priority instead. The `art` class (globals.css) tunes each to the
 * theme and the appearance: the drawings are violet and ember, so neutral themes take them quieter.
 */

export type ArtId = "hero-light" | "hero-dark" | "decisions" | "capture" | "handoffs" | "memory" | "hearback" | "assistants" | "cta-band" | "spot-boulder" | "spot-signal" | "og-card" | BlogCoverId;

/** The blog's covers, one per post, drawn for it (public/blog/covers). */
export type BlogCoverId = "blog-launch" | "blog-flip" | "blog-assistants" | "blog-fleets";

interface ArtFile {
  path: string;
  width: number;
  height: number;
  format: string;
}

interface ArtEntry {
  id: string;
  files: ArtFile[];
  alt: string;
  /** The ground it was drawn for: a light page, a dark one, or any. */
  ground: string;
}

const ART = new Map<string, ArtEntry>((manifest as ArtEntry[]).map((entry) => [entry.id, entry]));

/** One illustration's manifest entry; throws at render if the id is missing, so a renamed file fails the build. */
export function artEntry(id: ArtId): ArtEntry {
  const entry = ART.get(id);
  if (!entry) throw new Error(`No illustration "${id}" in public/marketing/manifest.json`);
  return entry;
}

const srcSet = (files: ArtFile[]) => files.map(({ path, width }) => `${path} ${width}w`).join(", ");

export interface ArtProps {
  id: ArtId;
  /** The `sizes` the browser picks a width by. */
  sizes: string;
  className?: string;
  /** Decorative where the words beside it already say it; the manifest's alt otherwise. */
  decorative?: boolean;
  /** The hero's art: fetched first. Still `lazy`, so the appearance that is hidden is never fetched. */
  priority?: boolean;
}

export function Art({ id, sizes, className, decorative = false, priority = false }: ArtProps) {
  const { files, alt, ground } = artEntry(id);
  const avif = files.filter((file) => file.format === "avif");
  const webp = files.filter((file) => file.format === "webp");
  const largest = webp.at(-1) ?? files.at(-1)!;
  return (
    <picture className="contents">
      <source type="image/avif" srcSet={srcSet(avif)} sizes={sizes} />
      <source type="image/webp" srcSet={srcSet(webp)} sizes={sizes} />
      <img
        src={largest.path}
        width={largest.width}
        height={largest.height}
        alt={decorative ? "" : alt}
        loading="lazy"
        decoding="async"
        fetchPriority={priority ? "high" : undefined}
        data-art={id}
        data-ground={ground}
        className={cx("art", className)}
      />
    </picture>
  );
}

/**
 * The hero's hill at the turn of the light, in the appearance in force: both are rendered and CSS shows
 * one (`art-light`, `art-dark`, keyed on `data-appearance` like every token), so a change of appearance
 * swaps it in the same frame; the hidden one is lazy, so it is never fetched.
 */
export function HeroArt({ className, sizes = "100vw", decorative = false }: { className?: string; sizes?: string; decorative?: boolean }) {
  return (
    <>
      <Art id="hero-light" sizes={sizes} priority decorative={decorative} className={cx("art-light", className)} />
      <Art id="hero-dark" sizes={sizes} priority decorative={decorative} className={cx("art-dark", className)} />
    </>
  );
}
