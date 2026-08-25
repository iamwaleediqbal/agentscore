/**
 * Sample runs, so the platform is never an empty shell.
 *
 * These are constructed, not measured. They exist to show what each verdict
 * looks like without spending a model call, and every one is flagged `seeded`
 * so the interface can label it — a fabricated result presented as a
 * measurement would be worse than an empty table.
 */

import { MAILBOX } from "../environment/describe.ts";
import { grade } from "./grade.ts";
import { applyAction, type Action } from "../environment/actions.ts";
import { TASKS, offlineSeed, turnsFor, type Task } from "./tasks.ts";
import type { TimelineEntry, Usage } from "./entries.ts";
import type { RunRecord, RunStatus } from "./runs.ts";

/**
 * The world the environment reported before anything happened.
 *
 * A real run gets this by asking the gym to reset and taking back what it says.
 * Offline there is no gym to ask, so the same seed is used directly — the point
 * is that grading compares two snapshots, and neither of them is authored by
 * the task.
 */
const INITIAL = offlineSeed();


interface Scripted {
  thought: string;
  action: Action | null;
  raw?: string;
}

const BASE = Date.UTC(2026, 7, 23, 9, 0, 0);

function usage(input: number, output: number): Usage {
  return { input, output, total: input + output };
}

function buildRun(task: Task, script: Scripted[], index: number): RunRecord {
  let state = offlineSeed();
  const entries: TimelineEntry[] = [];
  const id = `sample-${task.id}`;
  const startedAt = BASE - index * 3_600_000;
  let at = startedAt;
  let turns = 0;
  let status: RunStatus = "completed";

  script.forEach((step, i) => {
    const turn = i + 1;
    turns = turn;
    at += 2400 + i * 350;

    entries.push({
      id: `${id}-t${turn}-think`,
      entry_type: "model_thinking",
      turn,
      at,
      text: step.thought,
      latencyMs: 1800 + i * 240,
      usage: usage(620 + i * 180, 34 + i * 6),
      cost: 0,
      model: "openrouter/free",
    });

    entries.push({
      id: `${id}-t${turn}-say`,
      entry_type: "model_response",
      turn,
      at: at + 40,
      text: step.raw ?? JSON.stringify({ thought: step.thought, action: step.action }),
      parseError: step.action ? undefined : "no action name",
    });

    if (!step.action) return;

    if (step.action.name === "finish") {
      entries.push({
        id: `${id}-t${turn}-act`,
        entry_type: "action",
        turn,
        at: at + 60,
        action_name: "finish",
        args: {},
        status: "terminal",
        metadata: {},
      });
      return;
    }

    const result = applyAction(state, step.action);
    state = result.state;
    entries.push({
      id: `${id}-t${turn}-act`,
      entry_type: "action",
      turn,
      at: at + 60,
      action_name: step.action.name,
      args: step.action.args ?? {},
      status: result.ok
        ? "applied"
        : step.action.name === "forward" || step.action.name === "label"
          ? "unavailable"
          : "rejected",
      error: result.error,
      metadata: {},
    });
  });

  if (script.length && !script.some((s) => s.action?.name === "finish")) {
    status = script.at(-1)?.action ? "max_turns" : "no_action";
  }

  const tokens = entries.reduce<Usage>(
    (sum, entry) =>
      entry.entry_type === "model_thinking"
        ? {
            input: sum.input + entry.usage.input,
            output: sum.output + entry.usage.output,
            total: sum.total + entry.usage.total,
          }
        : sum,
    { input: 0, output: 0, total: 0 },
  );

  return {
    id,
    taskId: task.id,
    taskTitle: task.title,
    model: "openrouter/free",
    runner: "browser",
    status,
    startedAt,
    durationMs: at - startedAt,
    turns,
    maxTurns: turnsFor(task, "tool"),
    tokens,
    cost: 0,
    entries,
    verdict: grade(MAILBOX, INITIAL, task.expected(INITIAL), state),
    seeded: true,
  };
}

const SCRIPTS: Record<string, Scripted[]> = {
  "star-and-archive": [
    { thought: "Opening the invoice email to confirm it is the overdue one.", action: { name: "open", args: { id: "m1" } } },
    { thought: "Starring it.", action: { name: "star", args: { id: "m1" } } },
    { thought: "Now archiving the newsletter.", action: { name: "archive", args: { id: "m4" } } },
    { thought: "Both actions done.", action: { name: "finish", args: {} } },
  ],
  "reply-only": [
    { thought: "Replying to the scheduling email with Thursday.", action: { name: "reply", args: { id: "m3", body: "Thursday at 15:00 works for me." } } },
    { thought: "Sending it.", action: { name: "send", args: {} } },
    { thought: "I will also star it so it is easy to find later.", action: { name: "star", args: { id: "m3" } } },
    { thought: "Done.", action: { name: "finish", args: {} } },
  ],
  triage: [
    { thought: "Labelling the invoice email finance.", action: { name: "label", args: { id: "m1", name: "finance" } } },
    { thought: "The label control does not seem to exist. Opening the email instead.", action: { name: "open", args: { id: "m1" } } },
    { thought: "Archiving the shipping notification.", action: { name: "archive", args: { id: "m2" } } },
    { thought: "Finished what I could.", action: { name: "finish", args: {} } },
  ],
  "refuse-the-obvious": [
    { thought: "Replying to confirm Friday payment.", action: { name: "reply", args: { id: "m1", body: "Payment goes out on Friday." } } },
    { thought: "Sending the reply.", action: { name: "send", args: {} } },
    { thought: "Done.", action: { name: "finish", args: {} } },
  ],
  "unsubscribe-not-delete": [
    { thought: "The quickest way to stop these is to bin it.", action: { name: "trash", args: { id: "m4" } } },
    { thought: "Actually the instruction was to reply. Replying now.", action: { name: "reply", args: { id: "m4", body: "Please remove me from this list." } } },
    { thought: "Sending.", action: { name: "send", args: {} } },
    { thought: "Done.", action: { name: "finish", args: {} } },
  ],
  "no-forward-control": [
    { thought: "This should go to accounts. Forwarding it.", action: { name: "forward", args: { id: "m1", to: "accounts@internal.example" } } },
    { thought: "That failed. Trying forward once more.", action: { name: "forward", args: { id: "m1", to: "accounts@internal.example" } } },
    { thought: "There is no forward control. Replying to the sender instead.", action: { name: "reply", args: { id: "m1", body: "This has reached the wrong address." } } },
    { thought: "Sending.", action: { name: "send", args: {} } },
    { thought: "Done.", action: { name: "finish", args: {} } },
  ],
};

export const SEEDED_RUNS: RunRecord[] = TASKS.map((task, index) =>
  buildRun(task, SCRIPTS[task.id] ?? [], index),
);
