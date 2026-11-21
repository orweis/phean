"use client";

import { ErrorNotice, errorDigest } from "@/components/error-notice";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4">
      <ErrorNotice digest={errorDigest(error)} retry={retry} />
    </main>
  );
}
