"use client";

/**
 * Filtering, as one row above the table.
 *
 * The shape is borrowed rather than invented: LangSmith and Braintrust both
 * put filtering in a toolbar of typed predicates over the results table, and
 * Inspect AI's log viewer uses the same idea as score pickers. Sidebar facets
 * are rare in this category, and for four dimensions they would cost more
 * width than they earn.
 *
 * Three properties this one holds to:
 *
 * Every option shows the count it would leave behind, and an option that would
 * leave nothing is disabled rather than clickable. A filter you have to apply
 * to discover it was empty is a filter that wastes a click every time.
 *
 * Counts are computed against the *other* dimensions, so the row never goes
 * dead: switching from one model to another is one click, not clear-then-pick.
 *
 * The result count is stated in full — "showing 6 of 24" — because a table
 * that has silently dropped three quarters of its rows looks exactly like a
 * table that only ever had six.
 */

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Option } from "@/lib/harness/filters";
import { cn } from "@/lib/utils";

export function FilterGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<string>[];
  value: string;
  onChange: (value: string) => void;
}) {
  // A dimension with one real value tells the reader nothing and costs a row
  // of width, so it does not draw itself.
  if (options.length <= 2) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {options.map((option) => {
        const active = option.value === value;
        const empty = option.count === 0 && !active;

        return (
          <button
            key={option.value}
            type="button"
            disabled={empty}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
              active
                ? "border-primary/45 bg-primary/[0.08] font-medium text-foreground"
                : "border-border text-muted-foreground hover:border-primary/35 hover:text-foreground",
              empty && "cursor-not-allowed opacity-40 hover:border-border hover:text-muted-foreground",
            )}
            title={empty ? `No runs match ${option.label} under the current filters` : undefined}
          >
            <span className="max-w-[16rem] truncate">{option.label}</span>
            <span
              className={cn(
                "tabular text-[10px]",
                active ? "text-muted-foreground" : "text-muted-foreground/70",
              )}
            >
              {option.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function FilterBar({
  children,
  showing,
  total,
  active,
  onClear,
  noun = "runs",
}: {
  children: React.ReactNode;
  showing: number;
  total: number;
  active: boolean;
  onClear: () => void;
  noun?: string;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-6">
        {children}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t pt-2.5 text-xs text-muted-foreground">
        <span className="tabular">
          {active ? (
            <>
              Showing <span className="font-medium text-foreground">{showing}</span> of {total}{" "}
              {noun}
            </>
          ) : (
            <>
              {total} {noun}
            </>
          )}
        </span>
        {active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
