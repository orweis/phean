/**
 * The desktop app's preload API, `window.pheanDesktop` (docs/apps/CONTRACTS.md, "Desktop preload API").
 * It exists only inside the desktop shell; in a browser `desktopShell()` is undefined.
 */
export interface PheanDesktop {
  /** The shell's version, e.g. "0.1.0". */
  version: string;
  platform: "darwin" | "win32" | "linux";
  /** Signs in through the system browser; resolves once signed in, and the window then reloads. */
  signInWithBrowser(provider: "github" | "google"): Promise<void>;
  /** Opens a same-origin path (account linking, password reset) in the system browser. */
  openInBrowser(path: string): Promise<void>;
}

declare global {
  interface Window {
    pheanDesktop?: PheanDesktop;
  }
}

/** The desktop shell's API when this page runs inside it. Call it only in the browser (an effect or an event). */
export function desktopShell(): PheanDesktop | undefined {
  return typeof window !== "undefined" && typeof window.pheanDesktop !== "undefined" ? window.pheanDesktop : undefined;
}
