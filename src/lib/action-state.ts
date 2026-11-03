/** Result of a form's server action, rendered by the form that submitted it. */
export interface ActionState {
  status: "idle" | "success" | "error";
  message?: string;
  data?: Record<string, unknown>;
  /** Changes on every completed submission, so forms can reset after success. */
  at?: number;
}

export const IDLE: ActionState = { status: "idle" };

/** The named strings an action handed back in `data`, or null unless every one is there. */
export function stringData<K extends string>(state: ActionState, ...keys: K[]): Record<K, string> | null {
  const entries = keys.map((key) => [key, state.data?.[key]] as const);
  return entries.every(([, value]) => typeof value === "string") ? (Object.fromEntries(entries) as Record<K, string>) : null;
}
