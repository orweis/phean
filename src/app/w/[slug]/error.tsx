"use client";

import { ErrorNotice, errorDigest } from "@/components/error-notice";

/** Keeps the workspace header and tabs on screen when one tab fails. */
export default function WorkspaceError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="py-16">
      <ErrorNotice digest={errorDigest(error)} retry={retry} />
    </div>
  );
}
