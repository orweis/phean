"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Pauses every looping animation on the page (WCAG 2.2.2), by setting `data-paused` on the root;
 * `globals.css` holds them all where they are. Hidden where motion is already off.
 */
export function MotionToggle() {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-paused", paused);
    return () => document.documentElement.removeAttribute("data-paused");
  }, [paused]);
  return (
    <Button size="sm" variant="ghost" aria-pressed={paused} onClick={() => setPaused(!paused)} className="motion-reduce:hidden">
      {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
      {paused ? "Play the animations" : "Pause the animations"}
    </Button>
  );
}
