import { STATIONS, TASK_STATUS_META, type Station, type StopViewState } from "@/lib/domain";

/** One colour per station, used by every chart so a hue means the same status everywhere. */
export const STATION_STYLE: Record<Station, { label: string; fill: string; svg: string }> = {
  inbox: { label: TASK_STATUS_META.inbox.label, fill: "bg-station-inbox", svg: "fill-station-inbox" },
  backlog: { label: TASK_STATUS_META.backlog.label, fill: "bg-station-backlog", svg: "fill-station-backlog" },
  todo: { label: TASK_STATUS_META.todo.label, fill: "bg-station-todo", svg: "fill-station-todo" },
  in_progress: { label: TASK_STATUS_META.in_progress.label, fill: "bg-station-progress", svg: "fill-station-progress" },
  done: { label: TASK_STATUS_META.done.label, fill: "bg-station-done", svg: "fill-station-done" },
};

export type StationCounts = Partial<Record<Station, number>>;

/** "2 inbox, 3 to do" for screen readers and tooltips; stations with no tasks are skipped. */
export function describeCounts(counts: StationCounts, stations: readonly Station[] = STATIONS): string {
  const parts = stations.filter((station) => counts[station]).map((station) => `${counts[station]} ${STATION_STYLE[station].label.toLowerCase()}`);
  return parts.length ? parts.join(", ") : "no tasks";
}

/**
 * A pipeline stop's state as a mark (`dot`, with the state's icon in it) and as the line leading
 * on from it (`stroke`, `dash`, `width`), so state reads by form before hue: dashed while handing
 * off or waiting on a person, solid while worked, a filled dot on arrival, broken when it failed,
 * dotted when skipped or not reached. Hues are the stations' and the tones' only.
 */
export const STOP_STYLE: Record<StopViewState, { dot: string; stroke: string; dash?: string; width: number }> = {
  upcoming: { dot: "border-2 border-edge bg-panel text-muted", stroke: "stroke-edge", width: 2 },
  handing_off: { dot: "border-2 border-dashed border-line-inbox bg-inbox-tint text-inbox-ink", stroke: "stroke-line-inbox", dash: "6 4", width: 3 },
  active: { dot: "border-2 border-station-progress bg-station-progress text-panel", stroke: "stroke-station-progress", width: 4 },
  waiting: { dot: "border-2 border-dashed border-wait-ink bg-wait-tint text-wait-ink motion-safe:animate-pulse", stroke: "stroke-wait-ink", dash: "6 4", width: 3 },
  done: { dot: "border-2 border-station-done bg-station-done text-panel", stroke: "stroke-station-done", width: 3 },
  failed: { dot: "border-2 border-late bg-late-tint text-late-ink", stroke: "stroke-late", dash: "3 5", width: 3 },
  skipped: { dot: "border-2 border-dotted border-edge bg-panel text-muted", stroke: "stroke-edge", dash: "1 5", width: 2 },
  not_reached: { dot: "border-2 border-dotted border-edge bg-panel text-muted opacity-70", stroke: "stroke-edge", dash: "1 7", width: 2 },
  cancelled: { dot: "border-2 border-edge bg-fill text-muted", stroke: "stroke-edge", dash: "1 5", width: 2 },
};
