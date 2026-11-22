import { ImageResponse } from "next/og";

import { BrandTile } from "@/components/brand-tile";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The home screen icon: the mark on a dusk tile. */
export default function AppleIcon() {
  return new ImageResponse(<BrandTile size={size.width} />, size);
}
