/** Result of a form's server action, rendered by the form that submitted it. */
export interface ActionState {
  status: "idle" | "success" | "error";
  message?: string;
  data?: Record<string, unknown>;
  /** Changes on every completed submission, so forms can reset after success. */
  at?: number;
}

export const IDLE: ActionState = { status: "idle" };
