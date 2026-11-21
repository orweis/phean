import { appIcon } from "@/components/app-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The home screen icon on Apple devices. */
export default function AppleIcon() {
  return appIcon(size.width);
}
