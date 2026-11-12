"use client";

import { ArrowRight, Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { cx } from "@/lib/cx";
import { LIMITS } from "@/lib/domain";
import { pluralize } from "@/lib/format";
import { routes } from "@/lib/routes";
import { SUGGESTION_GROUP_LABELS, SUGGESTION_GROUPS, type Suggestion } from "@/lib/suggestions";

import { Input } from "./ui/field";

interface SearchFormProps {
  action: string;
  defaultValue?: string;
  placeholder: string;
  /** Other query values to keep when searching, e.g. an active filter. */
  keep?: Record<string, string | undefined>;
  autoFocus?: boolean;
  /** Names the box, e.g. "Search memory". */
  label?: string;
  /** The workspace whose suggestions to offer while typing; without it the box is a plain search. */
  suggestFor?: string;
  /**
   * Which box `/` focuses when a page has two: the page's own (`page`) before the one in the header
   * (`header`), which is also more compact.
   */
  placement?: "page" | "header";
}

/** The highlighted option: tinted, and marked by an accent bar as selected requests are, so it never rests on a faint tint alone. */
const ACTIVE_OPTION = "bg-accent-tint text-accent-ink before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-accent";

/** How long typing must pause before suggestions are asked for, in milliseconds. */
const SETTLE_MS = 120;

/**
 * A plain GET form, so results are linkable and the back button works. The capsule has a clear
 * button, and `/` focuses it from anywhere on the page (see `SearchShortcut`).
 *
 * With `suggestFor` it is also a combobox (the WAI-ARIA pattern): as a person types it lists places
 * to go, task filters and the best matches by kind, and the last option searches for the words.
 * Arrow keys move through the list, Enter opens the highlighted one (or searches when none is),
 * Escape closes the list, then clears the box.
 */
export function SearchForm({ action, defaultValue, placeholder, keep = {}, autoFocus, label = "Search", suggestFor, placement = "page" }: SearchFormProps) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const listId = `${id}-suggestions`;
  const [value, setValue] = useState(defaultValue ?? "");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const kept = Object.entries(keep).filter((entry): entry is [string, string] => Boolean(entry[1]));
  const words = value.trim();

  // Ask for suggestions once typing settles; a newer query cancels the one in flight.
  useEffect(() => {
    if (!suggestFor || !words) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(routes.suggest(suggestFor, words), { signal: controller.signal });
        if (!response.ok) return;
        const body = (await response.json()) as { suggestions: Suggestion[] };
        setSuggestions(body.suggestions);
        setActive(-1);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setSuggestions([]);
      }
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [suggestFor, words]);

  // The last option always searches for what was typed, so Enter on an empty highlight does too.
  const options: Suggestion[] = suggestFor && words ? [...suggestions, { group: "page", key: "search", label: `Search for “${words}”`, href: routes.search(suggestFor, words) }] : [];
  const expanded = open && options.length > 0;
  const optionId = (index: number) => `${id}-option-${index}`;

  const go = (suggestion: Suggestion) => {
    setOpen(false);
    setActive(-1);
    // The header stays across pages, so its words would follow the person there; start it afresh.
    if (placement === "header") {
      setValue("");
      setSuggestions([]);
    }
    router.push(suggestion.href, { scroll: false });
  };

  const clear = () => {
    setValue("");
    setSuggestions([]);
    input.current?.focus();
    if (defaultValue) {
      const query = new URLSearchParams(kept).toString();
      router.replace(query ? `${action}?${query}` : action, { scroll: false });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!suggestFor) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length) return;
      event.preventDefault();
      // Opening the list with Up starts from its last option, as the combobox pattern has it.
      if (!expanded) {
        setOpen(true);
        setActive(event.key === "ArrowDown" ? 0 : options.length - 1);
        return;
      }
      setActive((current) => (event.key === "ArrowDown" ? Math.min(current + 1, options.length - 1) : Math.max(current - 1, -1)));
    } else if (event.key === "Enter" && expanded && active >= 0) {
      event.preventDefault();
      go(options[active]!);
    } else if (event.key === "Escape") {
      // The first Escape closes the list; the next clears the words.
      event.preventDefault();
      if (expanded) {
        setOpen(false);
        setActive(-1);
      } else if (value) clear();
    }
  };

  // Options in their groups. The server sends them in group order, so an option's place in
  // `suggestions` is its place in the list the arrow keys walk.
  const groups = SUGGESTION_GROUPS.map((group) => ({ group, items: suggestions.filter((suggestion) => suggestion.group === group) })).filter(({ items }) => items.length);

  return (
    <form action={action} role="search" aria-label={label} className={cx("relative w-full", placement === "page" ? "max-w-md" : "max-w-72")}>
      {kept.map(([name, keptValue]) => (
        <input key={name} type="hidden" name={name} value={keptValue} />
      ))}
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <label htmlFor={`${id}-query`} className="sr-only">
        {label}
      </label>
      <Input
        ref={input}
        id={`${id}-query`}
        name="q"
        type="search"
        shape="pill"
        data-search-input={placement}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
          setActive(-1);
          if (!event.target.value.trim()) setSuggestions([]);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        placeholder={placeholder}
        maxLength={LIMITS.query}
        autoFocus={autoFocus}
        autoComplete="off"
        aria-keyshortcuts="/"
        role={suggestFor ? "combobox" : undefined}
        aria-autocomplete={suggestFor ? "list" : undefined}
        aria-expanded={suggestFor ? expanded : undefined}
        aria-controls={suggestFor ? listId : undefined}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        className={cx("pr-10 pl-10 [&::-webkit-search-cancel-button]:appearance-none", placement === "header" && "h-8.5")}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear the search"
          onClick={clear}
          className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-fill hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
      {suggestFor && (
        <>
          <div
            id={listId}
            role="listbox"
            aria-label={`Suggestions for ${words}`}
            hidden={!expanded}
            // Choosing with the mouse must not blur the box first, which would close the list.
            onMouseDown={(event) => event.preventDefault()}
            className="glass-float absolute top-full left-0 z-40 mt-1.5 max-h-[min(70vh,32rem)] w-full min-w-80 overflow-y-auto rounded-xl p-1.5"
          >
            {groups.map(({ group, items }) => (
              <div key={group} role="group" aria-labelledby={`${id}-${group}`} className="py-1">
                <p id={`${id}-${group}`} role="presentation" className="px-2.5 pb-1 text-2xs font-semibold text-muted">
                  {SUGGESTION_GROUP_LABELS[group]}
                </p>
                {items.map((suggestion) => {
                  const at = suggestions.indexOf(suggestion);
                  return (
                    <div
                      key={suggestion.key}
                      id={optionId(at)}
                      role="option"
                      aria-selected={active === at}
                      data-suggestion={suggestion.group}
                      onClick={() => go(suggestion)}
                      onMouseMove={() => setActive(at)}
                      className={cx("relative flex cursor-pointer items-baseline gap-2 rounded-md px-2.5 py-1.5 text-sm", active === at ? ACTIVE_OPTION : "text-ink")}
                    >
                      <span className="min-w-0 flex-1 truncate">{suggestion.label}</span>
                      {suggestion.detail && <span className={cx("max-w-[45%] min-w-0 truncate text-xs", active === at ? "text-accent-ink" : "text-muted")}>{suggestion.detail}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
            {words && (
              <div
                id={optionId(options.length - 1)}
                role="option"
                aria-selected={active === options.length - 1}
                onClick={() => go(options.at(-1)!)}
                onMouseMove={() => setActive(options.length - 1)}
                className={cx(
                  "relative flex cursor-pointer items-center gap-2 rounded-md border-t border-rule px-2.5 py-2 text-sm font-semibold",
                  active === options.length - 1 ? ACTIVE_OPTION : "text-ink-2",
                )}
              >
                <ArrowRight aria-hidden className="size-3.5" />
                {options.at(-1)!.label}
              </div>
            )}
          </div>
          <p className="sr-only" aria-live="polite">
            {expanded && suggestions.length ? `${pluralize(suggestions.length, "suggestion")}. Use the arrow keys to choose one.` : ""}
          </p>
        </>
      )}
    </form>
  );
}

/** The header's search, from every page but Search itself, which has its own box. */
export function HeaderSearch({ slug }: { slug: string }) {
  const pathname = usePathname();
  if (pathname.startsWith(routes.search(slug))) return null;
  return <SearchForm action={routes.search(slug)} placeholder="Search or jump to…" label="Search the workspace" suggestFor={slug} placement="header" />;
}
