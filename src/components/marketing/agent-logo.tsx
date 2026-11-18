import { Bot } from "lucide-react";
import Link from "next/link";

import { cx } from "@/lib/cx";
import { routes } from "@/lib/routes";

/*
 * The agents and assistants Phean names, each with its maker's mark. Every mark is one path drawn in
 * `currentColor`, so it follows every theme and appearance; none is redrawn or altered, only scaled.
 *
 * Sources (path data copied verbatim):
 * - Claude, Claude Code, Cursor: Simple Icons 16.36.0 (CC0 1.0), icons/claude.svg, icons/claudecode.svg,
 *   icons/cursor.svg; https://simpleicons.org, each icon's own source is the vendor's site or brand page.
 * - VS Code: Microsoft's Codicons 0.0.40 (CC BY 4.0, (c) Microsoft Corporation), src/icons/vscode.svg;
 *   https://github.com/microsoft/vscode-codicons. The site credits it where the strip names VS Code.
 * - ChatGPT: the OpenAI mark as OpenAI publishes it in its own repository,
 *   https://github.com/openai/openai-agents-python/blob/main/docs/assets/logo.svg (one path, filled white
 *   there, `currentColor` here; the viewBox is cropped to the mark's own bounds).
 * - Grok (xAI) and Muse (Meta's personal agent): Lobe Icons, @lobehub/icons-static-svg 1.104.0 (MIT,
 *   (c) LobeHub), icons/grok.svg and icons/muse.svg; https://github.com/lobehub/lobe-icons.
 * - Dots: its mark is a plain thick ring (a heavy "O"), redrawn here as two concentric circles in the
 *   same proportions: the hole is about 0.41 of the outer width.
 * Instinct (Spear Street Technology) publishes no mark Phean could take from an official or openly
 * licensed source, so it shows a neutral monogram chip (an initial in a ring), never an imitation of a logo.
 */

interface Mark {
  viewBox: string;
  d: string;
  /** As the source draws it; a mark with holes in one path needs "evenodd". */
  fillRule?: "evenodd";
}

const MARKS = {
  claude: { viewBox: "0 0 24 24", d: "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" },
  "claude-code": { viewBox: "0 0 24 24", d: "M21 10.5h3v3h-3v3h-1.5v3H18v-3h-1.5v3H15v-3H9v3H7.5v-3H6v3H4.5v-3H3v-3H0v-3h3v-6h18Zm-15 0h1.5v-3H6Zm10.5 0H18v-3h-1.5z" },
  cursor: { viewBox: "0 0 24 24", d: "M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" },
  "vs-code": { viewBox: "0 0 16 16", d: "M10.8634 13.9195C10.6568 14.0195 10.4233 14.0246 10.2185 13.9444C10.1162 13.9044 10.021 13.843 9.93997 13.7614L4.81616 9.06268L2.58433 10.7656C2.37657 10.9241 2.08597 10.9111 1.89301 10.7347L1.17719 10.0802C0.941168 9.86437 0.940898 9.49112 1.17661 9.27496L3.11213 7.5L1.17661 5.72504C0.940898 5.50888 0.941168 5.13563 1.17719 4.91982L1.89301 4.2653C2.08597 4.08887 2.37657 4.07588 2.58433 4.2344L4.81616 5.93732L9.93997 1.23855C9.97037 1.20797 10.0028 1.18023 10.0368 1.15538C10.2748 0.981429 10.5922 0.949298 10.8634 1.08048L13.5399 2.37507C13.8212 2.5111 14 2.79721 14 3.11109V8H10.752V4.53356L6.86419 7.5L10.752 10.4664V8H14V11.8889C14 12.2028 13.8211 12.4889 13.5399 12.625L10.8634 13.9195Z" },
  openai: { viewBox: "118.5 120.7 484.3 480", d: "M304.246 295.411V249.828C304.246 245.989 305.687 243.109 309.044 241.191L400.692 188.412C413.167 181.215 428.042 177.858 443.394 177.858C500.971 177.858 537.44 222.482 537.44 269.982C537.44 273.34 537.44 277.179 536.959 281.018L441.954 225.358C436.197 222 430.437 222 424.68 225.358L304.246 295.411ZM518.245 472.945V364.024C518.245 357.304 515.364 352.507 509.608 349.149L389.174 279.096L428.519 256.543C431.877 254.626 434.757 254.626 438.115 256.543L529.762 309.323C556.154 324.679 573.905 357.304 573.905 388.971C573.905 425.436 552.315 459.024 518.245 472.941V472.945ZM275.937 376.982L236.592 353.952C233.235 352.034 231.794 349.154 231.794 345.315V239.756C231.794 188.416 271.139 149.548 324.4 149.548C344.555 149.548 363.264 156.268 379.102 168.262L284.578 222.964C278.822 226.321 275.942 231.119 275.942 237.838V376.986L275.937 376.982ZM360.626 425.922L304.246 394.255V327.083L360.626 295.416L417.002 327.083V394.255L360.626 425.922ZM396.852 571.789C376.698 571.789 357.989 565.07 342.151 553.075L436.674 498.374C442.431 495.017 445.311 490.219 445.311 483.499V344.352L485.138 367.382C488.495 369.299 489.936 372.179 489.936 376.018V481.577C489.936 532.917 450.109 571.785 396.852 571.785V571.789ZM283.134 464.79L191.486 412.01C165.094 396.654 147.343 364.029 147.343 332.362C147.343 295.416 169.415 262.309 203.48 248.393V357.791C203.48 364.51 206.361 369.308 212.117 372.665L332.074 442.237L292.729 464.79C289.372 466.707 286.491 466.707 283.134 464.79ZM277.859 543.48C223.639 543.48 183.813 502.695 183.813 452.314C183.813 448.475 184.294 444.636 184.771 440.797L279.295 495.498C285.051 498.856 290.812 498.856 296.568 495.498L417.002 425.927V471.509C417.002 475.349 415.562 478.229 412.204 480.146L320.557 532.926C308.081 540.122 293.206 543.48 277.854 543.48H277.859ZM396.852 600.576C454.911 600.576 503.37 559.313 514.41 504.612C568.149 490.696 602.696 440.315 602.696 388.976C602.696 355.387 588.303 322.762 562.392 299.25C564.791 289.173 566.231 279.096 566.231 269.024C566.231 200.411 510.571 149.067 446.274 149.067C433.322 149.067 420.846 150.984 408.37 155.305C386.775 134.192 357.026 120.758 324.4 120.758C266.342 120.758 217.883 162.02 206.843 216.721C153.104 230.637 118.557 281.018 118.557 332.357C118.557 365.946 132.95 398.571 158.861 422.083C156.462 432.16 155.022 442.237 155.022 452.309C155.022 520.922 210.682 572.266 274.978 572.266C287.931 572.266 300.407 570.349 312.883 566.028C334.473 587.141 364.222 600.576 396.852 600.576Z" },
  dots: { viewBox: "0 0 24 24", fillRule: "evenodd", d: "M12 1a11 11 0 1 1 0 22 11 11 0 0 1 0-22Zm0 6.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" },
  grok: { viewBox: "0 0 24 24", fillRule: "evenodd", d: "M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" },
  muse: { viewBox: "0 0 24 24", d: "M5.91 3.869C6.777 3.869 7.396 4.546 7.396 5.607 7.396 6.669 7.225 7.626 6.941 9.659 6.738 11.084 6.389 13.258 6.243 14.162 6.523 13.628 7.178 12.378 7.294 12.144 8.666 9.375 10.096 6.901 10.508 6.246 11.054 5.372 11.535 5.021 12.278 5.021 12.664 5.022 13.124 5.217 13.352 5.477 13.66 5.829 13.725 6.398 13.714 7.019 13.698 7.97 13.574 9.486 13.405 11.177 13.33 11.929 13.185 13.466 13.087 14.496 13.965 12.925 15.591 10.035 16.246 9.025 16.817 8.146 17.392 7.579 18.164 7.579 18.83 7.579 19.651 8.05 19.603 9.302 19.531 11.149 19.264 15.174 19.143 16.979 19.96 15.79 21.033 14.029 21.436 13.367 21.842 12.698 22.26 12.157 22.894 12.139 23.544 12.12 23.979 12.562 23.999 13.244 24.019 13.927 23.612 14.694 23.072 15.565 22.486 16.511 21.831 17.523 21.033 18.468 20.236 19.413 19.502 20.131 18.384 20.131 17.382 20.131 16.677 19.465 16.628 18.246 16.602 17.607 16.723 16.234 16.814 15.16 16.92 13.917 17.048 12.717 17.137 11.923 16.256 13.535 14.402 16.912 13.568 18.23 12.752 19.52 12.355 19.974 11.493 19.975 10.631 19.975 10.253 19.354 10.241 18.42 10.227 17.407 10.988 11.324 11.246 9.297 10.828 10.191 9.801 12.385 9.157 13.69 8.534 14.953 7.489 17.135 6.73 18.393 6.184 19.298 5.57 19.975 4.66 19.975 3.75 19.975 3.236 19.363 3.236 18.379 3.236 17.395 3.521 15.756 3.827 13.723 3.98 12.739 4.155 11.667 4.352 10.53 4.496 9.708 4.746 8.26 4.9 7.371 4.2 8.461 2.941 10.423 2.558 11.014 2.131 11.671 1.749 12.15 1.115 12.15 0.416 12.15 0 11.605 0 10.971 0 10.337 0.322 9.848 0.846 8.988 1.518 7.883 2.726 6.377 3.388 5.586 4.168 4.654 4.947 3.869 5.91 3.869Z" },
} satisfies Record<string, Mark>;

export type AgentGroup = "coding" | "assistant";

export interface Agent {
  name: string;
  /** Its page in the docs, under Agents. */
  docs: string;
  group: AgentGroup;
  /** The maker's mark, or `null` for a monogram chip where no usable official mark exists. */
  mark: keyof typeof MARKS | null;
}

/** Every agent the site names, in the order the strip shows them: one table for the marks, the links and the groups. */
export const AGENTS: readonly Agent[] = [
  { name: "Claude Code", docs: "claude-code", group: "coding", mark: "claude-code" },
  { name: "Cursor", docs: "cursor", group: "coding", mark: "cursor" },
  { name: "VS Code", docs: "vs-code", group: "coding", mark: "vs-code" },
  { name: "Claude", docs: "claude-apps", group: "assistant", mark: "claude" },
  { name: "ChatGPT", docs: "chatgpt-dots", group: "assistant", mark: "openai" },
  { name: "Grok", docs: "grok", group: "assistant", mark: "grok" },
  { name: "Dots", docs: "chatgpt-dots", group: "assistant", mark: "dots" },
  { name: "Muse", docs: "muse", group: "assistant", mark: "muse" },
  { name: "Instinct", docs: "instinct", group: "assistant", mark: null },
];

/** The docs pages that are an agent's own, and the mark each shows (the docs' Agents table uses it). */
const BY_DOCS = new Map<string, Agent["mark"] | "bot">([
  ...AGENTS.map(({ docs, mark }) => [docs, mark] as const).filter(([docs]) => docs !== "chatgpt-dots"),
  ["chatgpt-dots", "openai"],
  ["your-own-bot", "bot"],
]);

/** The mark for one agent's docs page (`/docs/grok`), or `undefined` when the page is not an agent's. */
export function markForDocsPage(href: string): { mark: Agent["mark"] | "bot"; name: string } | undefined {
  const slug = /^\/docs\/([a-z0-9-]+)$/.exec(href)?.[1];
  if (!slug || !BY_DOCS.has(slug)) return undefined;
  return { mark: BY_DOCS.get(slug)!, name: AGENTS.find((agent) => agent.docs === slug)?.name ?? slug };
}

/**
 * One agent's mark, decorative beside its visible name: the vendor's path in `currentColor`, or a
 * monogram chip (the name's initial in a hairline ring). Sized by `className` (default 1em square).
 */
export function AgentMark({ mark, name, className = "size-[1em]" }: { mark: Agent["mark"] | "bot"; name: string; className?: string }) {
  if (mark === "bot") return <Bot aria-hidden className={cx("shrink-0", className)} />;
  if (mark === null) {
    return (
      <span
        aria-hidden
        data-monogram={name.charAt(0)}
        className={cx(
          "inline-flex shrink-0 items-center justify-center rounded-full font-sans leading-none font-semibold ring-[1.5px] ring-current ring-inset",
          "before:text-[0.6em] before:content-[attr(data-monogram)]",
          className,
        )}
      />
    );
  }
  const { viewBox, d, fillRule } = MARKS[mark] as Mark;
  return (
    <svg aria-hidden viewBox={viewBox} fill="currentColor" className={cx("shrink-0", className)} data-mark={mark}>
      <path d={d} fillRule={fillRule} clipRule={fillRule} />
    </svg>
  );
}

/** An agent's mark and name, linked to its docs page; the name is the link's text. */
export function AgentLink({ agent, className, markClassName }: { agent: Agent; className?: string; markClassName?: string }) {
  return (
    <Link href={routes.docs(agent.docs)} className={cx("inline-flex items-center gap-[0.4em]", className)}>
      <AgentMark mark={agent.mark} name={agent.name} className={markClassName} />
      {agent.name}
    </Link>
  );
}
