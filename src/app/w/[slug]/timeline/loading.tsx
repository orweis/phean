import { cx } from "@/lib/cx";

const BAR = "rounded-sm bg-fill motion-safe:animate-pulse";

/** The timeline's frame while it loads: the flow chart's card, then one wide timetable of empty tracks. */
export default function TimelineLoading() {
  return (
    <div role="status">
      <span className="sr-only">Loading the timeline</span>
      <div aria-hidden>
        <div className={cx(BAR, "h-8 w-36")} />
        <div className={cx(BAR, "mt-2 mb-6 h-4 w-full max-w-xl")} />
        <div className="mb-6 h-72 rounded-lg border border-rule bg-panel" />
        <div className="rounded-lg border border-rule bg-panel">
          <div className="border-b border-rule px-5 py-4">
            <div className={cx(BAR, "h-4 w-32")} />
          </div>
          <div className="space-y-5 px-5 py-5">
            {Array.from({ length: 8 }, (_, row) => (
              <div key={row} className="flex items-center gap-4">
                <div className={cx(BAR, "h-3.5 w-32 shrink-0 sm:w-56")} />
                <div className="h-0 flex-1 border-t-2 border-dashed border-rule" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
