import { cx } from "@/lib/cx";

const BAR = "rounded-sm bg-fill motion-safe:animate-pulse";

/** Holds a backoffice tab's frame while its figures load: a title, a row of figures and two cards. */
export default function BackofficeLoading() {
  return (
    <div role="status">
      <span className="sr-only">Loading</span>
      <div aria-hidden>
        <div className={cx(BAR, "h-8 w-52")} />
        <div className="mt-6 h-20 surface rounded-lg border border-rule" />
        <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="surface h-44 rounded-lg border border-rule p-5">
              <div className={cx(BAR, "h-4 w-28")} />
              <div className={cx(BAR, "mt-3 h-7 w-16")} />
              <div className={cx(BAR, "mt-6 h-12 w-full")} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
