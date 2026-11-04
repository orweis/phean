import { cx } from "@/lib/cx";

const BAR = "rounded-sm bg-fill motion-safe:animate-pulse";

/** The board's frame while it loads: four lanes of empty cards, so the layout is already the board's. */
export default function BoardLoading() {
  return (
    <div role="status">
      <span className="sr-only">Loading the board</span>
      <div aria-hidden>
        <div className={cx(BAR, "h-8 w-28")} />
        <div className={cx(BAR, "mt-2 mb-6 h-4 w-full max-w-md")} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[4, 3, 3, 5].map((cards, lane) => (
            <div key={lane}>
              <span className="block h-1 rounded-full bg-fill" />
              <div className={cx(BAR, "mt-2.5 mb-2.5 h-4 w-20")} />
              <div className="flex flex-col gap-2">
                {Array.from({ length: cards }, (_, card) => (
                  <div key={card} className="h-24 rounded-md border border-rule bg-panel" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
