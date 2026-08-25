"use client";

/**
 * The verdict as a control, not a column.
 *
 * Grading is what you check once and then stop looking at; the trajectory is
 * what you actually read. Giving them equal width meant the thing being studied
 * was squeezed into half a pane and truncated, while a two-line answer occupied
 * the other half permanently.
 *
 * So the verdict collapses to its outcome — a tick or a cross you can read
 * across the room — and the detail behind it opens on demand.
 */



import { ChangeList } from "@/components/harness/change-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Grade } from "@/lib/harness/grade";
import { metaFor } from "@/lib/harness/verdict-meta";
import type { Task } from "@/lib/harness/tasks";
import { cn } from "@/lib/utils";

export function GradingDialog({
  verdict,
  task,
  size = "default",
}: {
  verdict: Grade | null;
  task?: Task;
  size?: "default" | "sm";
}) {
  // One shared table of names, icons and explanations. These used to be
  // defined here as well and had already drifted from the badge's copy.
  const look = metaFor(verdict?.status);
  const { Icon } = look;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "gap-2 font-medium",
            cn(look.text, look.ring),
            size === "sm" && "h-8 px-2.5 text-xs",
          )}
          aria-label={`Grading: ${look.label}. Open the detail.`}
        >
          <Icon className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden />
          {look.label}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-4" aria-hidden />
            {look.label}
          </DialogTitle>
          <DialogDescription>{look.hint}</DialogDescription>
        </DialogHeader>

        {verdict && (
          <div className="space-y-4">
            <ChangeList title="Not done" changes={verdict.missing} tone="missing" />
            <ChangeList
              title="Changed unnecessarily"
              changes={verdict.extra}
              tone="extra"
            />
          </div>
        )}

        {task && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Tests for: </span>
            {task.probes}
          </div>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          Grading compares the mailbox left behind against the one a correct solve produces —
          never the route taken, because there are many correct routes and a shorter one is
          not a failure.
        </p>
      </DialogContent>
    </Dialog>
  );
}
