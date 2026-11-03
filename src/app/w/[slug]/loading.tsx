import { cx } from "@/lib/cx";

const BAR = "rounded-sm bg-fill motion-safe:animate-pulse";

/** A panel whose rows are a label and an empty dashed track, like a timetable before it fills. */
function PanelPlaceholder({ rows }: { rows: number }) {
  return (
    <div className="rounded-lg border border-rule bg-panel">
      <div className="border-b border-rule px-5 py-4">
        <div className={cx(BAR, "h-4 w-36")} />
      </div>
      <div className="space-y-5 px-5 py-5">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-4">
            <div className={cx(BAR, "h-3.5 w-32 shrink-0 sm:w-48")} />
            <div className="h-0 flex-1 border-t-2 border-dashed border-rule" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Holds a workspace tab's frame while its data loads, so switching tabs answers at once. */
export default function WorkspaceLoading() {
  return (
    <div role="status">
      <span className="sr-only">Loading</span>
      <div aria-hidden>
        <div className={cx(BAR, "h-8 w-52")} />
        <div className={cx(BAR, "mt-2 h-4 w-full max-w-md")} />
        <div className="mt-6 h-20 rounded-lg border border-rule bg-panel" />
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <PanelPlaceholder rows={5} />
            <PanelPlaceholder rows={3} />
          </div>
          <PanelPlaceholder rows={4} />
        </div>
      </div>
    </div>
  );
}
