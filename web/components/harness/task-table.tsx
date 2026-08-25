"use client";

/**
 * The task list as something to scan, not to read.
 *
 * Six tasks as cards filled a screen and a half with prose nobody re-reads.
 * What a reader wants from the list is which tasks exist and how each one went
 * in each action space — one row each. Everything else is behind the eye.
 */

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
import { TASKS, type Difficulty } from "@/lib/harness/tasks";
import { cell } from "@/lib/harness/analytics";
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

export function TaskTable() {
  const { runs, ready } = useRuns();

  if (!ready) return <Skeleton className="h-72 w-full" />;

  return (
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
          {TASKS.map((task) => {
            const look = DIFFICULTY[task.difficulty];
            const computer = cell(runs, task.id, "computer");
            const tool = cell(runs, task.id, "tool");

            return (
              <TableRow key={task.id}>
                <TableCell className="max-w-[280px]">
                  <div className="font-medium">{task.title}</div>
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
    </div>
  );
}
