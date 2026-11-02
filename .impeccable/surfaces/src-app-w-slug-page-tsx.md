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

THESIS: Work runs on a line. Each task departs the inbox, stops at to do and in progress, and arrives at done, and the app is set like a railway timetable, so a track's colour shows where a task stood each day and a long flat run shows stuck work. It refuses the grey card dashboard with a row of stat tiles and a violet accent.

OWN-WORLD: A station-board navy shell (header and tab rail) in white type, with a signal-yellow bar under the current tab; a cool white timetable sheet as the ground; hairline rules, no shadows, 4 to 6px corners. One family, Archivo, ranked by width: semi-condensed heads, normal-width text, tabular figures everywhere. Signal red only for now and late, green for arrived, amber for awaiting a decision, blue for moving.

STORY: The owner reads, in order: what awaits their decision, what is late, how the work moved this fortnight, and what departs next. They approve, nudge a task, or open a goal to see its map and its timetable.

FIRST VIEWPORT: Navy header with the wordmark, workspace switcher and the tab rail (Overview, Board, Timeline, Memory, Search, Agents, Members) with counts on Overview and Board. Below on the sheet: the workspace name and one status sentence; a full-width "today on the line" strip (a stacked bar of open work by station, then late, due this week, arrived in 7 days, agents active). Left two thirds: decisions awaiting approval, then the cumulative flow of the last 14 days with a red now line. Right third: late work and the agents' workload. The primary action (New goal or Connect an agent) is a navy button at the title row's right.

FORM: graphic timetable, candidate 4 of 7 on my ordered list (survey map, expedition camp ladder, trail signage, graphic timetable, summit register, piste map, black-figure amphora). seed: seed:bcf0dfd644159d55
- Raise from the emission-line rail: state is carried by line form as well as hue (solid moving, dashed waiting, a struck end for dropped work).
- Raise from the streaming wall: focusing one track dims the others.
- Raise from the labanotation score: every segment's length is its exact duration on one shared time axis.
- Raise from the acetate tab manual: the tab rail shows extent (awaiting approval on Overview, inbox on Board).
- Raise from the ticket wallet: nothing disappears, it cancels; dropped tasks stay on the timetable, struck.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment

The timeline page: every task as a track on one time axis, coloured by station, with the red now line running through all of them.
