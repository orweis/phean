import { appIcon } from "@/components/app-icon";
import { APP_ICON_SIZES, routes } from "@/lib/routes";

/** The app icon at each size the manifest lists (`/icons/192.png`, `/icons/512.png`), drawn at build time. */
const ICONS = new Map<string, number>(APP_ICON_SIZES.map((size) => [routes.appIcon(size).split("/").at(-1)!, size]));

export const dynamicParams = false;

export function generateStaticParams() {
  return [...ICONS.keys()].map((icon) => ({ icon }));
}

export async function GET(_request: Request, { params }: RouteContext<"/icons/[icon]">) {
  const size = ICONS.get((await params).icon);
  if (!size) return new Response("Not found", { status: 404 });
  return appIcon(size);
}
