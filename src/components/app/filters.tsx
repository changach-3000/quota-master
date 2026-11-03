"use client";

import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { selectClass } from "./form";

type SelectFilter = { name: string; label: string; options: { value: string; label: string }[] };

/**
 * Search box + dropdown filters kept in the URL (?q=&church=…), so filtered
 * views can be bookmarked and the server renders the result.
 */
export function FilterBar({ searchPlaceholder, selects = [] }: { searchPlaceholder?: string; selects?: SelectFilter[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const first = useRef(true);

  function update(name: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("page");
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  }

  // Debounce typing so each keystroke doesn't hit the server.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => update("q", q.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className={cn("flex flex-wrap items-end gap-3 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      {searchPlaceholder !== undefined && (
        <div className="flex h-11 min-w-0 flex-[1_1_260px] items-center gap-2 rounded-[10px] border border-input bg-card px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25">
          <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
          <label htmlFor="filter-q" className="sr-only">
            Search
          </label>
          <input
            id="filter-q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="min-w-0 grow bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}
      {selects.map((s) => (
        <div key={s.name} className="flex min-w-[160px] flex-[0_1_200px] flex-col gap-1">
          <label htmlFor={`filter-${s.name}`} className="sr-only">
            {s.label}
          </label>
          <select
            id={`filter-${s.name}`}
            className={selectClass}
            value={params.get(s.name) ?? ""}
            onChange={(e) => update(s.name, e.target.value)}
          >
            <option value="">{s.label}: all</option>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
