---
name: Phean
description: A shared task and goal ledger for teams of AI agents, read like a railway timetable.
colors:
  shell: "oklch(29% 0.085 266)"
  shell-2: "oklch(36% 0.09 266)"
  shell-ink: "oklch(98.5% 0.005 265)"
  shell-muted: "oklch(81% 0.035 265)"
  signal: "oklch(86% 0.165 93)"
  signal-ink: "oklch(30% 0.06 90)"
  signal-tint: "oklch(95.5% 0.055 95)"
  late: "oklch(56% 0.21 27)"
  late-ink: "oklch(47% 0.18 27)"
  late-tint: "oklch(96.2% 0.025 25)"
  wait: "oklch(72% 0.15 68)"
  wait-ink: "oklch(47% 0.11 60)"
  wait-tint: "oklch(96.5% 0.04 82)"
  move: "oklch(53% 0.15 256)"
  move-ink: "oklch(45% 0.14 258)"
  move-tint: "oklch(95.6% 0.028 255)"
  arrive: "oklch(57% 0.12 155)"
  arrive-ink: "oklch(43% 0.1 155)"
  arrive-tint: "oklch(95.6% 0.035 155)"
  station-inbox: "oklch(82% 0.15 90)"
  station-todo: "oklch(76% 0.03 262)"
  line-inbox: "oklch(62% 0.13 78)"
  line-todo: "oklch(57% 0.035 262)"
  paper: "oklch(97.4% 0.007 255)"
  panel: "oklch(99.6% 0.002 255)"
  sunken: "oklch(94.6% 0.011 255)"
  rule: "oklch(90% 0.012 260)"
  edge: "oklch(60% 0.025 262)"
  ink: "oklch(24% 0.05 266)"
  ink-2: "oklch(37% 0.04 265)"
  muted: "oklch(49% 0.03 262)"
  faint: "oklch(70% 0.02 262)"
  focus: "oklch(53% 0.15 256)"
typography:
  display:
    fontFamily: "Archivo Variable, ui-sans-serif, sans-serif"
    fontSize: "clamp(2.25rem, 6vw, 4.25rem)"
    fontWeight: 800
    lineHeight: 1.02
    fontVariation: "'wdth' 82"
  headline:
    fontFamily: "Archivo Variable, ui-sans-serif, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 800
    lineHeight: "2.15rem"
    fontVariation: "'wdth' 86"
  title:
    fontFamily: "Archivo Variable, ui-sans-serif, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: "1.55rem"
    fontVariation: "'wdth' 86"
  figure:
    fontFamily: "Archivo Variable, ui-sans-serif, sans-serif"
    fontSize: "1.4375rem"
    fontWeight: 700
    lineHeight: "1.85rem"
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 82"
  body:
    fontFamily: "Archivo Variable, ui-sans-serif, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.35rem"
    fontFeature: "'tnum'"
  label:
    fontFamily: "Archivo Variable, ui-sans-serif, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: "1.1rem"
  axis:
    fontFamily: "Archivo Variable, ui-sans-serif, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: "1rem"
rounded:
  xs: "2px"
  sm: "3px"
  md: "4px"
  lg: "6px"
  xl: "8px"
spacing:
  gutter-phone: "16px"
  gutter: "24px"
  stack: "24px"
  card-inset: "20px"
components:
  button-primary:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.shell-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.shell-2}"
  button-primary-active:
    backgroundColor: "{colors.ink}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.sunken}"
  button-ghost:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  button-signal:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.late-ink}"
    rounded: "{rounded.md}"
    height: "36px"
  badge:
    rounded: "{rounded.sm}"
    padding: "0 6px"
    height: "20px"
    typography: "{typography.label}"
  card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    padding: "{spacing.card-inset}"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "36px"
  header:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.shell-ink}"
  tab-active:
    textColor: "{colors.shell-ink}"
    typography: "{typography.label}"
---

# Design System: Phean

The tokens above mirror the `@theme` block in `src/app/globals.css`, which is the source of truth. That block resets Tailwind's default palette (`--color-*: initial`), so a class like `text-zinc-500` does not exist here: every colour is one of these names.

## Overview

**Creative North Star: "The Graphic Timetable"**

Work runs on a line. Every task is a track that sets out when an agent captures it and runs through four stations (inbox, to do, in progress, done) until it arrives or is dropped, and the red line is now. The interface is set like a railway timetable: a navy station board on top, a cool timetable sheet below, ruled in hairlines, with one signal yellow for where you are and what is new.

The density is that of an operations screen, not a marketing page. People check in a few times a day to see what agents did, what is late, and what awaits their decision, so the overview leads with the line and the decisions, and every figure is a tabular numeral with its label. Colour carries meaning only: a hue is a station or a state, never decoration.

**Key Characteristics:**

- A navy station-board header with a tab rail; the page below is a pale sheet of white panels on hairline rules.
- One accent, signal yellow, used sparingly; four station hues shared by every chart and lane.
- State is carried by line form as well as hue: dashed while waiting, solid while moving, a dot on arrival, a slash when dropped.
- Archivo Variable throughout, narrowed on its width axis for titles and figures.
- Flat surfaces; the only shadow belongs to things that float (menus and popovers).

## Colors

A cool, blue-grey sheet under a deep navy board, with one yellow signal and four state hues that mean the same thing on every screen.

### Primary

- **Station-board navy** (`shell`): the header, the tab rail, the primary button, the selected window in a segmented control, and the landing hero. `shell-2` is its hover. Text on it is `shell-ink`, and secondary text `shell-muted`.

### Secondary

- **Signal yellow** (`signal`): the active tab's underline, the count chips on the tab rail, the one call to action on a navy surface, the boulder in the logo, the last station on the landing route. `signal-ink` is the text that sits on it, and `signal-tint` the text-selection colour and the accent badge.

### Tertiary

- **Late red** (`late`, `late-ink`, `late-tint`): the now line, late tracks and cards, urgent priority, and destructive buttons.
- **Waiting amber** (`wait`, `wait-ink`, `wait-tint`): goals awaiting a decision, high priority, read-only access.
- **Moving blue** (`move`, `move-ink`, `move-tint`): in-progress work, active goals, agent claims, focus rings.
- **Arrived green** (`arrive`, `arrive-ink`, `arrive-tint`): done tasks, achieved goals, active agents.
- **The four stations**: inbox is ochre (`station-inbox`), to do is slate (`station-todo`), in progress is moving blue, and done is arrived green. Thin timetable lines use the darker cuts `line-inbox` and `line-todo`, which keep 3:1 against the sheet.

### Neutral

- **Timetable sheet** (`paper`): the page background.
- **Panel white** (`panel`): cards, inputs, popovers.
- **Sunken grey** (`sunken`): board lanes, hover fills, the future side of the now line, skeletons.
- **Hairline** (`rule`) and **Edge** (`edge`): dividers and card borders; `edge` outlines form controls.
- **Ink** (`ink`), **Ink 2** (`ink-2`), **Muted** (`muted`), **Faint** (`faint`): text from titles down to empty-state icons.

### Named Rules

**The One Signal Rule.** Yellow marks where you are and what is new: the active tab, the counts on the rail, and one call to action on navy. It is never a panel fill and never text on the sheet.

**The Station Rule.** A station hue means that status everywhere: in the flow bar, the board lane's top rail, the cumulative flow and the timetable. Nothing else borrows those hues.

**The Red Line Rule.** Red is the now line and late work, plus urgent priority and destructive actions. If something is red, a person should look at it today.

## Typography

**Display Font:** Archivo Variable (with ui-sans-serif)
**Body Font:** Archivo Variable (with ui-sans-serif)
**Label/Mono Font:** ui-monospace for tokens and digests only

**Character:** One grotesque in one variable family, condensed on its width axis for headings (86%), figures and the display (82%), and the wordmark (66%), like the narrow faces on a printed timetable. All numerals are tabular, so columns of figures line up.

### Hierarchy

- **Display** (800, clamp(2.25rem, 6vw, 4.25rem), 1.02): the landing headline only.
- **Headline** (800, 1.75rem, 2.15rem): the page title, one per screen.
- **Title** (700, 1rem, 1.55rem): card and section titles.
- **Figure** (700, 1.4375rem, condensed, tabular): stat values and due dates in lead columns.
- **Body** (400, 0.875rem, 1.35rem): running text and table cells; descriptions stay under about 70ch.
- **Label** (600, 0.75rem, 1.1rem): buttons, field labels, badges, tab names. Sentence case, never uppercase.
- **Axis** (400, 0.6875rem, 1rem): chart axes, track notes and the Now chip.

### Named Rules

**The Four Weights Rule.** 400 for running text, 600 for labels, 700 for titles and figures, 800 only for the page title and the display.

## Layout

Workspace screens sit in an 80rem container with 16px gutters on phones and 24px from the small breakpoint. From the large breakpoint (1024px) the overview and goal pages use three columns: the main column spans two (the line, next actions, the goal map) and a rail holds late work, agents and activity. Cards stack 24px apart and pad their content 20px from the edge; card headers are a title, an optional description and one action on the right.

On phones both columns dissolve into a single stack ordered by what needs a person first: the decision card, late work, the line, next actions, the goal map, agents, activity. Wide tables keep their first column pinned while the figures scroll beside it inside the card. Popovers open as a sheet across the screen. The timetable puts each task's label above its track. The tab rail scrolls sideways and fades at its right edge to say so.

## Elevation & Depth

Flat by default. Depth comes from tonal layering: white panels on the pale sheet, sunken lanes and hover fills, the shaded future past the now line. Borders are hairlines.

### Shadow Vocabulary

- **Pop** (`box-shadow: 0 10px 28px -10px oklch(24% 0.05 266 / 0.35), 0 2px 6px -2px oklch(24% 0.05 266 / 0.18)`): menus, the workspace switcher and popovers, the only things that float over the page.

### Named Rules

**The Flat Sheet Rule.** Cards, lanes and tables never cast a shadow. If something needs to stand out, give it a state tone, not elevation.

## Shapes

Small, firm corners: 2px for chart bars and chips, 3px for badges, 4px for buttons and inputs, 6px for cards, 8px at most. Round shapes are reserved for the line: the hollow dot where a track sets out, the green dot where it arrives, and the boulder. Each board lane is topped with a 4px rail in its station colour, and a dropped track ends in a short slash.

## Components

### Buttons

- **Shape:** gently squared (4px), 36px tall; small buttons are 32px with a hit area extended to 44px.
- **Primary:** navy with white text. Hover lightens to `shell-2`, and pressing darkens to ink.
- **Secondary:** a white panel button with a hairline border, sunken on hover.
- **Ghost:** text only, for the secondary actions in a row (Release, Drop, Open board).
- **Signal:** yellow with dark text, used once per navy surface; the landing hero's call to action is 44px tall.
- **Danger:** red text on white with a faint red border, and it always asks for confirmation.
- **Focus:** a 2px moving-blue outline offset 2px; on navy the ring turns signal yellow.

### Chips

- **Style:** badges are 20px tall, 3px corners, a tint of their tone with the tone's ink and a faint inset ring. Every status, priority, role and memory kind renders through its `{ label, tone }` table in `src/lib/domain.ts`.
- **Counts:** the tab rail's counts are signal-yellow chips with dark numerals.

### Cards / Containers

- **Corner Style:** 6px.
- **Background:** panel white; the decision card is tinted waiting amber and the late card late red, in both their border and header.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** one hairline.
- **Internal Padding:** 20px; the header is ruled off from the body.

### Inputs / Fields

- **Style:** white, a 1px edge border, 4px corners, 36px tall, full width of their wrapper (size the wrapper, not the control).
- **Focus:** the border and a 2px outline turn moving blue.
- **Error / Disabled:** errors show inline under the form in late ink; disabled controls go sunken with muted text.

### Navigation

The station-board header is navy: the boulder wordmark, a workspace switcher, the account, and below them the tab rail (Overview, Board, Timeline, Memory, Search, Agents, Members). Tabs are muted until hovered; the active tab is white, semibold, with a 3px signal-yellow underline. Inline text links underline on hover and thicken the underline while pressed (the `link` utility).

### Flow bar

Open work by station as one stacked bar in flow order, with a legend of swatches and counts. It names itself for screen readers ("Open work by status: 5 inbox, 4 to do, 5 in progress").

### Timetable (signature)

Every task is a track on one time axis, grouped under its goal (or flat, on the overview). Inbox and to do are dashed in their station colour, in progress is a solid blue bar, arrival is a green dot, a drop is a slash, a due date is a short ink tick, and a late stretch is shaded red up to the red now line. The Now chip sits on the date baseline and any date label it would cover is left off. Hovering a track dims the others. The window shows the last 14, 30 or 90 days plus a week ahead, and starts with the history when the history is shorter.

### Cumulative flow

A stacked area of how many tasks stood at each station at the end of each day: done is the floor, the open stations ride on it, and a widening band is work piling up. "Show the numbers" opens the same data as a table. With fewer than three days of work it says the chart fills in instead of drawing a sliver.

### Goal map

The goal tree as a line with stations: a navy ring per active goal, a dashed amber ring while proposed, a filled green dot when achieved, a grey one when abandoned, branches for sub-goals, and a flow bar of each goal's tasks with its percentage done.

## Do's and Don'ts

### Do:

- **Do** use the token names (`bg-panel`, `text-ink-2`, `border-rule`, `bg-station-progress`) and nothing from Tailwind's default palette.
- **Do** give every chart a text equivalent: a `role="img"` name built with `describeCounts`, track notes in words, or a "Show the numbers" table.
- **Do** use the `link` utility for inline text links so they have hover and pressed states.
- **Do** pin the first column of a wide table with `PINNED_CELL` from `src/components/ui/table.ts`, and make its scroller `relative`.
- **Do** put motion behind `motion-safe:` and keep it brisk: 120ms for colour changes, 220ms for the timetable's dimming.
- **Do** add `data-*` hooks (`data-task`, `data-goal`, `data-segment`, `data-end`, `data-now`, `data-tick`) for UI tests instead of selecting by class.

### Don't:

- **Don't** set small labels in uppercase or letter-spaced; use sentence case at the label size.
- **Don't** put yellow text on the sheet or use yellow as a panel fill.
- **Don't** use red for anything that is not late, now, urgent or destructive.
- **Don't** add shadows to cards or lanes, or gradients anywhere.
- **Don't** glue arrows to button text or put an eyebrow line above a heading.
- **Don't** clamp text over another element; shorten it (task cards cut descriptions at 80 characters) or move it.

## System

The locked system for Hallmark runs: every page shares it.

- Genre: modern-minimal
- Shape of the first page: app screen
- Theme: custom (vibe: "station board navy over a timetable sheet"; idea: "work runs on a line, set like a railway timetable")
- Axes: light/grotesk-sans/chromatic-yellow · posture: committed shell, full palette for the four stations

## Controls

- Primary: navy fill · 4px · 36px
- Secondary: white with a hairline border · same radius and height

## Motion

- Character: brisk; no reveals; under reduced motion every transition ends at once.

## Exports

`src/app/globals.css` in this project (the `@theme` block and the `link` and `font-stretch-*` utilities).
