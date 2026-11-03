---
version: 1
slug: "src-app-w-slug-page-tsx"
primary_target: "src/app/w/[slug]/page.tsx"
related_targets: ["src/app/w/[slug]/timeline/page.tsx","src/app/w/[slug]/goals/[id]/page.tsx"]
---

## Scope

The signed-in web app: workspace dashboard (`/w/<slug>`), board, timeline, goal pages, memory, search, agents, members, the workspaces table, and the auth pages. Mode: Operate. The landing page shares the system but is a Persuade surface.

## Brief

- Audience: workspace owners and operators checking what agents did, what is late, and what awaits a decision; a few visits a day.
- Task: approve or reject proposed goals, spot late and stuck work, open a goal to see how it is moving, connect agents.
- Constraints: every existing route, form, action and test hook stays; the 15 second refresh stays; no invented figures; demo data is labelled sample data.
- Inferred, not interviewed: the run was unattended, so the audience and task come from PRODUCT.md and docs/PRD.md.

## Direction contract

THESIS: Work runs on a line, up a hill. Each task departs the inbox, stops at to do and in progress, and arrives at done, and the app is set like a timetable, so a track's colour shows where a task stood each day and a long flat run shows stuck work. The world is Sisyphus's slope at dusk: a violet hill and the ember boulder the agents keep rolling up it. It refuses the grey card dashboard with a row of stat tiles, and the purple gradient hero.

OWN-WORLD (restyled by request: a violet and ember theme in Apple's design language, with Liquid Glass): a lavender-white ground with white cards on hairlines and no card shadows; a Liquid Glass functional layer on top (the sticky header, the workspace switcher, popovers and the phone sheet), blurred and saturated with a hairline rim and a scroll edge where content passes under it. Capsule controls: buttons, tabs, badges and segmented controls. SF Pro on Apple devices and Inter Variable elsewhere, three weights, tabular figures everywhere, rounded figures on Apple devices. Violet for the brand, primary actions, the selected tab, focus and work in progress; ember for the boulder, the counts on the rail, the inbox and the one call to action on a dusk band; crimson only for now and late, green for arrived, honey for awaiting a decision. Light, Dark, or System (the default, following the device), picked in the account menu or the landing footer and rendered from a cookie, at 4.5:1 for text and 3:1 for lines in both palettes.

STORY: The owner reads, in order: what awaits their decision, what is late, how the work moved this fortnight, and what departs next. They approve, nudge a task, or open a goal to see its map and its timetable.

FIRST VIEWPORT: The glass header with the boulder wordmark, workspace switcher and the capsule tab rail (Overview, Board, Timeline, Memory, Search, Agents, Members) with ember counts on Overview and Board. Below on the ground: the workspace name and one status sentence; a full-width "today on the line" strip (a stacked bar of open work by station, then late, due this week, arrived in 7 days, agents active). Left two thirds: decisions awaiting approval, then the line of the most pressing open tasks with a red now line. Right third: late work and the agents' workload. Manual entry is a quiet ghost button at the title row's right, because agents do most of the capturing.

FORM: graphic timetable, candidate 4 of 7 on my ordered list (survey map, expedition camp ladder, trail signage, graphic timetable, summit register, piste map, black-figure amphora). seed: seed:bcf0dfd644159d55
- Raise from the emission-line rail: state is carried by line form as well as hue (solid moving, dashed waiting, a struck end for dropped work).
- Raise from the streaming wall: focusing one track dims the others.
- Raise from the labanotation score: every segment's length is its exact duration on one shared time axis.
- Raise from the acetate tab manual: the tab rail shows extent (awaiting approval on Overview, inbox on Board).
- Raise from the ticket wallet: nothing disappears, it cancels; dropped tasks stay on the timetable, struck.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment

The timeline page: every task as a track on one time axis, coloured by station, with the red now line running through all of them.
