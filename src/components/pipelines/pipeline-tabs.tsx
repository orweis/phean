import { BarChart3, ListOrdered, Map as MapIcon, PencilRuler } from "lucide-react";
import Link from "next/link";

import { cx } from "@/lib/cx";
import { routes } from "@/lib/routes";

import { ChipRail } from "../ui/chip-rail";
import { segment, SEGMENTED } from "../ui/segmented";

export type PipelineTab = "map" | "runs" | "insights" | "definition";

const TABS: { key: PipelineTab; label: string; icon: typeof MapIcon }[] = [
  { key: "map", label: "Map", icon: MapIcon },
  { key: "runs", label: "Runs", icon: ListOrdered },
  { key: "insights", label: "Insights", icon: BarChart3 },
  { key: "definition", label: "Definition", icon: PencilRuler },
];

/** Map · Runs · Insights · Definition, as one segmented control of links, each its own URL. */
export function PipelineTabs({ slug, pipelineId, tab, proposals }: { slug: string; pipelineId: string; tab: PipelineTab; proposals: number }) {
  return (
    <ChipRail label="Pipeline views" selected={tab} className={cx(SEGMENTED, "mb-5 w-fit max-w-full")}>
      {TABS.map(({ key, label, icon: Icon }) => (
        <Link
          key={key}
          href={routes.pipeline(slug, pipelineId, key === "map" ? undefined : { tab: key })}
          aria-current={key === tab ? "page" : undefined}
          className={cx(segment(key === tab), "inline-flex items-center gap-1.5 whitespace-nowrap")}
        >
          <Icon aria-hidden className="size-3.5" />
          {label}
          {key === "insights" && proposals > 0 && (
            <span className="figure rounded-full bg-wait-tint px-1.5 text-2xs text-wait-ink">
              {proposals}
              <span className="sr-only"> {proposals === 1 ? "proposal" : "proposals"}</span>
            </span>
          )}
        </Link>
      ))}
    </ChipRail>
  );
}
