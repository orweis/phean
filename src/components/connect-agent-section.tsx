"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cx } from "@/lib/cx";

import { buttonClasses } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";

/**
 * Connecting an agent: the first card while a workspace has none, then a slim bar that opens on
 * demand, so the agents themselves lead the page. The form stays mounted in one place either way,
 * so a token it just issued stays on screen (it is shown only once) after the page refreshes with
 * the new agent in the list.
 */
export function ConnectAgentSection({ collapsed, title, description, children }: { collapsed: boolean; title: string; description: string; children: ReactNode }) {
  const [open, setOpen] = useState(!collapsed);
  const shown = open || !collapsed;
  return (
    <Card className="mb-6" data-connect={shown ? "open" : "folded"}>
      <CardHeader
        title={title}
        description={description}
        divided={shown}
        action={
          collapsed && (
            <button type="button" aria-expanded={shown} className={buttonClasses(shown ? "ghost" : "secondary", "sm")} onClick={() => setOpen((value) => !value)}>
              {shown ? <ChevronDown aria-hidden className="rotate-180" /> : <Plus aria-hidden />}
              {shown ? "Hide" : "Connect an agent"}
            </button>
          )
        }
      />
      <div hidden={!shown} className={cx(!shown && "hidden")}>
        <CardBody>{children}</CardBody>
      </div>
    </Card>
  );
}
