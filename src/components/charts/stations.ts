import { STATIONS, TASK_STATUS_META, type Station } from "@/lib/domain";

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
