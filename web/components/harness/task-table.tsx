"use client";

/**
 * The task list as something to scan, not to read.
 *
 * Six tasks as cards filled a screen and a half with prose nobody re-reads.
 * What a reader wants from the list is which tasks exist and how each one went
 * in each action space — one row each. Everything else is behind the eye.
 *
 * The model control is not decoration. Each cell shows one verdict, so with
 * more than one model recorded the table has to say which model's verdict that
 * is; without the control it would quietly show whichever model ran last, and
 * a row could mix two models across its two columns. Braintrust and LangSmith
 * both make you name a baseline before they will draw a comparison, for the
 * same reason.
 */

import { useMemo, useState } from "react";

import { FilterBar, FilterGroup } from "@/components/harness/filter-bar";
import { TaskDetail } from "@/components/harness/task-detail";
import { VerdictBadge } from "@/components/harness/verdict-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRuns } from "@/hooks/use-runs";
import { TASKS, type Difficulty, type Task } from "@/lib/harness/tasks";
import { cell } from "@/lib/harness/analytics";
import { OUTCOME_LABEL, outcomeOf, type Outcome } from "@/lib/harness/filters";
import type { RunRecord } from "@/lib/harness/runs";
import type { Option } from "@/lib/harness/filters";
import { cn } from "@/lib/utils";

const DIFFICULTY: Record<Difficulty, { label: string; className: string; hint: string }> = {
  basic: {
    label: "Basic",
    className: "bg-status-good/10 text-status-good ring-status-good/25",
    hint: "Does what it says. Present so a failure elsewhere can be told apart from a model that cannot operate the interface at all.",
  },
  careful: {
    label: "Careful",
    className: "bg-status-warning/12 text-status-warning ring-status-warning/25",
    hint: "Executable, but with a trap for an agent that acts on the first thing it reads rather than the thing it was asked about.",
  },
  adversarial: {
    label: "Adversarial",
    className: "bg-status-critical/10 text-status-critical ring-status-critical/25",
    hint: "The obvious helpful move is the wrong one. These are the tasks that separate a careful agent from an eager one.",
  },
};

const DIFFICULTIES: Difficulty[] = ["basic", "careful", "adversarial"];
const OUTCOMES: Outcome[] = ["passed-both", "split", "failed-both", "partial", "not-run"];

const ALL = "all";

interface TaskFilters {
  model: string;
  difficulty: Difficulty | typeof ALL;
  outcome: Outcome | typeof ALL;
}

function survives(task: Task, filters: TaskFilters, scoped: RunRecord[]): boolean {
  if (filters.difficulty !== ALL && task.difficulty !== filters.difficulty) return false;
  if (filters.outcome !== ALL && outcomeOf(scoped, task.id, filters.model) !== filters.outcome) return false;
  return true;
}

/** Counts computed against the other dimension, so neither row goes dead. */
function count(
  filters: TaskFilters,
  scoped: RunRecord[],
  key: "difficulty" | "outcome",
  value: string,
): number {
  const others = { ...filters, [key]: ALL } as TaskFilters;
  return TASKS.filter(
    (task) => survives(task, others, scoped) && survives(task, { ...others, [key]: value } as TaskFilters, scoped),
  ).length;
}

export function TaskTable() {
  const { runs, ready } = useRuns();

  // Ordered by how much evidence each model has, so the default selection is
  // the model the table can actually say the most about.
  const models = useMemo(() => {
    const tally = new Map<string, number>();
    for (const run of runs) tally.set(run.model, (tally.get(run.model) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [runs]);

  const [chosen, setChosen] = useState<string | null>(null);
  const model = chosen && models.some(([id]) => id === chosen) ? chosen : (models[0]?.[0] ?? "");

  const [filters, setFilters] = useState<Omit<TaskFilters, "model">>({
    difficulty: ALL,
    outcome: ALL,
  });
  const active: TaskFilters = { ...filters, model };

  const scoped = useMemo(() => runs.filter((run) => run.model === model), [runs, model]);
  const shown = useMemo(
    () => TASKS.filter((task) => survives(task, active, scoped)),
    // `active` is rebuilt every render; its two meaningful parts are these.
    [filters, model, scoped], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const groups = useMemo(() => {
    const modelOptions: Option<string>[] = models.map(([id, runCount]) => ({
      value: id,
      label: id.split("/").pop() ?? id,
      count: runCount,
    }));

    return {
      // No "All" here: a cell shows one verdict, so the table must name whose.
      model: modelOptions.length > 1 ? modelOptions : [],
      difficulty: [
        { value: ALL, label: "All", count: TASKS.filter((t) => survives(t, { ...active, difficulty: ALL }, scoped)).length },
        ...DIFFICULTIES.map((value) => ({
          value: value as string,
          label: DIFFICULTY[value].label,
          count: count(active, scoped, "difficulty", value),
        })),
      ],
      outcome: [
        { value: ALL, label: "All", count: TASKS.filter((t) => survives(t, { ...active, outcome: ALL }, scoped)).length },
        ...OUTCOMES.map((value) => ({
          value: value as string,
          label: OUTCOME_LABEL[value],
          count: count(active, scoped, "outcome", value),
        })),
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, filters, model, scoped]);

  if (!ready) return <Skeleton className="h-72 w-full" />;

  const filtered = filters.difficulty !== ALL || filters.outcome !== ALL;

  return (
    <div className="space-y-4">
      <FilterBar
        showing={shown.length}
        total={TASKS.length}
        active={filtered}
        onClear={() => setFilters({ difficulty: ALL, outcome: ALL })}
        noun="tasks"
      >
        {groups.model.length > 0 && (
          <FilterGroup
            label="Model"
            options={groups.model}
            value={model}
            onChange={setChosen}
          />
        )}
        <FilterGroup
          label="Difficulty"
          options={groups.difficulty}
          value={filters.difficulty}
          onChange={(value) =>
            setFilters((c) => ({ ...c, difficulty: value as TaskFilters["difficulty"] }))
          }
        />
        <FilterGroup
          label="Outcome"
          options={groups.outcome}
          value={filters.outcome}
          onChange={(value) =>
            setFilters((c) => ({ ...c, outcome: value as TaskFilters["outcome"] }))
          }
        />
      </FilterBar>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead className="hidden sm:table-cell">Difficulty</TableHead>
              <TableHead>
                <Tooltip>
                  <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-4">
                    Computer use
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[240px] text-xs leading-relaxed">
                    Screenshot in, coordinates out. Finding the control is part of the task.
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead>
                <Tooltip>
                  <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-4">
                    Tool calling
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[240px] text-xs leading-relaxed">
                    Named actions with ids already resolved. The control condition: deciding
                    what to do, but not where.
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((task) => {
              const look = DIFFICULTY[task.difficulty];
              const computer = cell(scoped, task.id, "computer", model);
              const tool = cell(scoped, task.id, "tool", model);
              const disagree = outcomeOf(scoped, task.id, model) === "split";

              return (
                <TableRow key={task.id}>
                  <TableCell className="max-w-[280px]">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{task.title}</span>
                      {disagree && (
                        <Tooltip>
                          <TooltipTrigger className="cursor-help rounded-full bg-chart-1/12 px-1.5 py-0.5 text-[10px] font-medium text-chart-1 ring-1 ring-chart-1/25">
                            spaces disagree
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[260px] text-xs leading-relaxed">
                            Same instruction, same grader, same model — and a different verdict
                            depending on whether it was given coordinates or named actions. This
                            is the comparison the harness exists to draw.
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground" title={task.prompt}>
                      {task.prompt}
                    </div>
                  </TableCell>

                  <TableCell className="hidden sm:table-cell">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={cn(
                            "cursor-help whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                            look.className,
                          )}
                        >
                          {look.label}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[260px] text-xs leading-relaxed">
                        {look.hint}
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>

                  <TableCell>
                    {computer ? (
                      <VerdictBadge status={computer.verdict?.status ?? null} size="sm" />
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  <TableCell>
                    {tool ? (
                      <VerdictBadge status={tool.verdict?.status ?? null} size="sm" />
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  <TableCell className="text-right">
                    <TaskDetail task={task} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {shown.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No task matches that combination.
          </p>
        )}
      </div>
    </div>
  );
}
