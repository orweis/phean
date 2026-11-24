import { appIcon, notificationBadge } from "@/components/app-icon";
import { APP_ICON_SIZES, NOTIFICATION_BADGES, routes } from "@/lib/routes";

const fileOf = (path: string) => path.split("/").at(-1)!;

/**
 * The app icon at each size the manifest lists (`/icons/192.png`, `/icons/512.png`), and each
 * notification badge (`/icons/badge-request.png`), drawn at build time.
 */
const ICONS = new Map<string, () => Response>([
  ...APP_ICON_SIZES.map((size) => [fileOf(routes.appIcon(size)), () => appIcon(size)] as const),
  ...NOTIFICATION_BADGES.map((kind) => [fileOf(routes.notificationBadge(kind)), () => notificationBadge(kind)] as const),
]);

export const dynamicParams = false;

export function generateStaticParams() {
  return [...ICONS.keys()].map((icon) => ({ icon }));
}

export async function GET(_request: Request, { params }: RouteContext<"/icons/[icon]">) {
  const draw = ICONS.get((await params).icon);
  if (!draw) return new Response("Not found", { status: 404 });
  return draw();
}
