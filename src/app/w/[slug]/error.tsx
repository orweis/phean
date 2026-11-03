"use client";

import { ErrorNotice } from "@/components/error-notice";

/** Keeps the workspace header and tabs on screen when one tab fails. */
export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="py-16">
      <ErrorNotice digest={error.digest} reset={reset} />
    </div>
  );
}
