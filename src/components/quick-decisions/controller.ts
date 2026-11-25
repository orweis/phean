import type { QuickItem } from "@/lib/quick-decisions";
import type { routes } from "@/lib/routes";

/** How an answer was given, for `decision_answer`'s `gesture`. */
export type AnswerGesture = "swipe" | "tap" | "dock" | "composer" | "keyboard";
/** How a request was snoozed, for `decision_snooze`'s `gesture`. */
export type SnoozeGesture = "swipe" | "button" | "keyboard";

/** What the Quick Decisions views ask of the page that holds the queue: its answers, picks and links. */
export interface QuickController {
  /** A link within Quick Decisions, keeping the browser's Back for each step. */
  href: (query?: Parameters<typeof routes.quickDecisions>[1]) => string;
  /** The id of a card's question, which names the card and takes focus when it arrives. */
  questionId: (item: QuickItem) => string;
  /** The options ticked on a request that takes several (its suggestions until the person changes them). */
  picksOf: (item: QuickItem) => number[];
  togglePick: (item: QuickItem, index: number) => void;
  /** What a swipe right (or the bar's button) sends, in words, or null when there is nothing to send. */
  sendLabel: (item: QuickItem) => string | null;
  /** Sends the recommended option, or the picks. */
  send: (item: QuickItem, gesture: AnswerGesture) => void;
  answerOption: (item: QuickItem, index: number, gesture: AnswerGesture) => void;
  answerText: (item: QuickItem, answer: string, gesture: AnswerGesture) => void;
  snooze: (item: QuickItem, gesture: SnoozeGesture) => void;
}
