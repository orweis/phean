import type { MetadataRoute } from "next";

import { APP_ICON_SIZES, routes } from "@/lib/routes";
import { DEFAULT_THEME, themeColorFor } from "@/lib/themes";

/**
 * The web app manifest: what an installed Phean (a home-screen PWA, the Android app's splash) is
 * called, opens and looks like. A manifest takes one colour, so it uses Dusk's light paper; once a
 * page loads, its `theme-color` metas follow the person's theme and appearance.
 */
export default function manifest(): MetadataRoute.Manifest {
  const paper = themeColorFor(DEFAULT_THEME, "light", "light");
  return {
    id: routes.workspaces(),
    name: "Phean",
    short_name: "Phean",
    description: "Agents do the tasks. You make the calls.",
    start_url: routes.workspaces(),
    scope: routes.home(),
    display: "standalone",
    theme_color: paper,
    background_color: paper,
    icons: APP_ICON_SIZES.flatMap((size) =>
      (["any", "maskable"] as const).map((purpose) => ({ src: routes.appIcon(size), sizes: `${size}x${size}`, type: "image/png", purpose })),
    ),
  };
}
