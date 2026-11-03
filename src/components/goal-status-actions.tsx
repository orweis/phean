import { Check, RotateCcw, Trophy, X, type LucideIcon } from "lucide-react";

import { setGoalStatusAction } from "@/app/w/[slug]/actions";
import type { GoalStatus } from "@/lib/domain";

import type { ButtonSize, ButtonVariant } from "./ui/button";
import { ActionButton } from "./ui/action-button";

interface Transition {
  label: string;
  to: GoalStatus;
  icon: LucideIcon;
  variant: ButtonVariant;
  confirm?: string;
}

/** The human decisions available from each goal status. */
const TRANSITIONS: Record<GoalStatus, readonly Transition[]> = {
  proposed: [
    { label: "Approve", to: "active", icon: Check, variant: "primary" },
    { label: "Reject", to: "abandoned", icon: X, variant: "ghost" },
  ],
  active: [
    { label: "Mark achieved", to: "achieved", icon: Trophy, variant: "primary" },
    { label: "Abandon", to: "abandoned", icon: X, variant: "ghost", confirm: "Abandon this goal? Its tasks stay where they are." },
  ],
  achieved: [{ label: "Reopen", to: "active", icon: RotateCcw, variant: "secondary" }],
  abandoned: [{ label: "Reactivate", to: "active", icon: RotateCcw, variant: "secondary" }],
};

export function GoalStatusActions({ goalId, status, slug, size = "md" }: { goalId: string; status: GoalStatus; slug: string; size?: ButtonSize }) {
  return (
    <div className="flex shrink-0 flex-wrap gap-1.5">
      {TRANSITIONS[status].map(({ label, to, icon: Icon, variant, confirm }) => (
        <ActionButton
          key={to}
          action={setGoalStatusAction}
          workspace={slug}
          fields={{ goalId, status: to }}
          confirm={confirm}
          size={size}
          variant={variant}
        >
          <Icon aria-hidden />
          {label}
        </ActionButton>
      ))}
    </div>
  );
}
