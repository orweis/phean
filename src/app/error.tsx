"use client";

import { ErrorNotice } from "@/components/error-notice";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4">
      <ErrorNotice digest={error.digest} reset={reset} />
    </main>
  );
}
