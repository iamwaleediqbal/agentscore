import { TaskTable } from "@/components/harness/task-table";

export const metadata = { title: "Tasks" };

export default function Tasks() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="max-w-[80ch] text-sm leading-relaxed text-muted-foreground">
          Each task is a starting mailbox, an instruction, and the mailbox a correct solve
          produces. The interesting ones are not the hardest to execute — they are the ones
          where the obvious move is wrong.
        </p>
      </header>

      <TaskTable />
    </div>
  );
}
