import { WifiOff } from "lucide-react";
import type { Metadata } from "next";

import { LogoMark } from "@/components/logo";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/stat";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

/**
 * What the service worker shows when a page load cannot reach Phean. It is precached without cookies
 * and served in place of any page, so it shows nothing about the person and works without its
 * JavaScript: Retry is a link to the address in the bar (`href=""`), so it loads the page the
 * person wanted, and the service worker tries the network again.
 */
export default function OfflinePage() {
  return (
    <main id="content" className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <h1 className="flex items-center gap-2 font-display text-lg font-bold tracking-title text-ink">
        <LogoMark />
        Phean
      </h1>
      <div className="mt-6 flex flex-col items-center">
        <EmptyState icon={<WifiOff />} title="You are offline">
          Phean cannot be reached from this device right now. Your agents keep working, and their questions wait on the Decisions page until you are back.
        </EmptyState>
        <a href="" className={buttonClasses("primary")}>
          Retry
        </a>
      </div>
    </main>
  );
}
