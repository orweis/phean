"use client";

import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { LIMITS } from "@/lib/domain";

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
}

/**
 * A plain GET form, so results are linkable and the back button works. The capsule has a clear
 * button, and `/` focuses it from anywhere on the page (see `SearchShortcut`).
 */
export function SearchForm({ action, defaultValue, placeholder, keep = {}, autoFocus, label = "Search" }: SearchFormProps) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue ?? "");
  const kept = Object.entries(keep).filter((entry): entry is [string, string] => Boolean(entry[1]));

  const clear = () => {
    setValue("");
    input.current?.focus();
    if (defaultValue) {
      const query = new URLSearchParams(kept).toString();
      router.replace(query ? `${action}?${query}` : action, { scroll: false });
    }
  };

  return (
    <form action={action} role="search" className="relative w-full max-w-md">
      {kept.map(([name, keptValue]) => (
        <input key={name} type="hidden" name={name} value={keptValue} />
      ))}
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <label htmlFor="search-query" className="sr-only">
        {label}
      </label>
      <Input
        ref={input}
        id="search-query"
        name="q"
        type="search"
        shape="pill"
        data-search-input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        maxLength={LIMITS.query}
        autoFocus={autoFocus}
        aria-keyshortcuts="/"
        className="pr-10 pl-10 [&::-webkit-search-cancel-button]:appearance-none"
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
    </form>
  );
}
