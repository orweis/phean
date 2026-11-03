import { addDays, isoDate, startOfUtcDay } from "@/lib/dates";
import { timeWindow, type Journey, type Stop } from "@/lib/timeline";
import type { TaskView } from "@/server/domain/tasks";

import { Timetable, type TimetableGroup } from "./charts/timetable";

type Leg = [status: Stop["status"], daysAgo: number];

interface SampleTask {
  title: string;
  /** Statuses with the day each began, oldest first; the last is where the task stands now. */
  legs: Leg[];
  /** Days from today; negative is in the past. */
  due?: number;
  claimedBy?: string;
}

const SAMPLE: { goal: string; tasks: SampleTask[] }[] = [
  {
    goal: "Close the quarter",
    tasks: [
      { title: "Reconcile November invoices", legs: [["inbox", 9], ["todo", 8], ["in_progress", 5], ["done", 2]], due: -3 },
      { title: "Chase the signed renewal", legs: [["inbox", 7], ["todo", 6], ["in_progress", 3]], due: -1, claimedBy: "Scout" },
      { title: "Draft the board update", legs: [["inbox", 6], ["todo", 4], ["in_progress", 1]], due: 2, claimedBy: "Scribe" },
    ],
  },
  {
    goal: "Plan the team offsite",
    tasks: [
      { title: "Shortlist three venues", legs: [["inbox", 5], ["todo", 2]], due: 5 },
      { title: "Answer the dietary survey thread", legs: [["inbox", 3]], due: 1 },
      { title: "Move the old wiki pages", legs: [["todo", 10], ["dropped", 4]] },
    ],
  },
];

/** Hand-written sample journeys, dated relative to now, so the landing page shows the real timetable. */
function sampleGroups(now: Date): TimetableGroup[] {
  const today = startOfUtcDay(now);
  const at = (daysAgo: number) => new Date(addDays(today, -daysAgo).getTime() + 10 * 3_600_000);
  return SAMPLE.map(({ goal, tasks }, groupIndex) => ({
    key: `sample-${groupIndex}`,
    title: goal,
    journeys: tasks.map(({ title, legs, due, claimedBy }, index): Journey<TaskView> => {
      const stops = legs.map(([status, daysAgo]) => ({ status, at: at(daysAgo) }));
      const last = stops.at(-1)!;
      return {
        stops,
        task: {
          id: `sample-${groupIndex}-${index}`,
          goalId: null,
          goalTitle: goal,
          title,
          description: "",
          status: last.status,
          priority: "medium",
          source: "manual",
          sourceRef: "",
          dueDate: due === undefined ? null : isoDate(addDays(today, due)),
          tags: [],
          claimedByAgentId: null,
          claimedByName: claimedBy ?? null,
          claimedAt: null,
          completedAt: last.status === "done" ? last.at : null,
          agentSessions: [],
          inputRequest: null,
          inputAnswers: [],
          links: [],
          parentTaskId: null,
          parentTitle: null,
          subtaskCount: 0,
          subtasksDone: 0,
          createdByType: "agent",
          createdById: "sample",
          createdByName: "Sample",
          createdAt: stops[0]!.at,
          updatedAt: last.at,
        },
      };
    }),
  }));
}

export function SampleTimetable({ now = new Date() }: { now?: Date }) {
  return <Timetable window={timeWindow(11, now, 6)} groups={sampleGroups(now)} />;
}
