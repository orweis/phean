"use client";

import { ErrorNotice, errorDigest } from "@/components/error-notice";

/** Keeps the backoffice's header and tabs on screen when one page fails. */
export default function BackofficeError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="py-16">
      <ErrorNotice digest={errorDigest(error)} retry={retry} />
    </div>
  );
}
