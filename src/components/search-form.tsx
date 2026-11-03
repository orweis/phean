import { Search } from "lucide-react";

import { LIMITS } from "@/lib/domain";

import { Input } from "./ui/field";

interface SearchFormProps {
  action: string;
  defaultValue?: string;
  placeholder: string;
  /** Other query values to keep when searching, e.g. an active filter. */
  keep?: Record<string, string | undefined>;
  autoFocus?: boolean;
}

/** A plain GET form, so results are linkable and the back button works. */
export function SearchForm({ action, defaultValue, placeholder, keep = {}, autoFocus }: SearchFormProps) {
  return (
    <form action={action} role="search" className="relative w-full max-w-md">
      {Object.entries(keep).map(([name, value]) => value && <input key={name} type="hidden" name={name} value={value} />)}
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <label htmlFor="search-query" className="sr-only">
        Search
      </label>
      <Input
        id="search-query"
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder={placeholder}
        maxLength={LIMITS.query}
        autoFocus={autoFocus}
        className="pl-9"
      />
    </form>
  );
}
