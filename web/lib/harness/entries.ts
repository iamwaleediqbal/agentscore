/**
 * A run is a sequence of timeline entries, not a list of actions.
 *
 * Separating what the model thought, what it said, and what it did is the
 * difference between a log and something you can diagnose from. A model that
 * reasoned correctly and then emitted the wrong action fails differently from
 * one that never understood the task, and a flat action list cannot tell them
 * apart.
 */

export type EntryType = "model_thinking" | "model_response" | "action";

export type ActionStatus = "applied" | "rejected" | "unavailable" | "terminal";

export interface Usage {
  input: number;
  output: number;
  total: number;
}

interface BaseEntry {
  id: string;
  turn: number;
  at: number;
}

export interface ThinkingEntry extends BaseEntry {
  entry_type: "model_thinking";
  /** What the model said it was doing — the `thought` field of its reply. */
  text: string;
  /**
   * The model's private chain of thought, when the provider returns one.
   *
   * Distinct from `text`, and not a substitute for it. `text` is what the model
   * chose to declare; this is what it actually worked through on the way there,
   * and the two can disagree — which is the interesting case. Absent unless a
   * run was deliberately made with REASONING set, because these tokens bill at
   * the output rate and were ninety-five per cent of the cost of a turn.
   */
  reasoning?: string;
  latencyMs: number;
  usage: Usage;
  cost: number;
  model?: string;
}

export interface ResponseEntry extends BaseEntry {
  entry_type: "model_response";
  text: string;
  /** Set when the reply could not be read as an action. */
  parseError?: string;
  /**
   * How the action arrived: as a tool call, or as prose the runner had to read.
   *
   * Recorded rather than assumed, because both are possible and they are not
   * the same result. Absent on runs from before the harness used tool calling
   * at all, when prose was the only path there was.
   */
  transport?: "tool_call" | "prose";
}

export interface ActionEntry extends BaseEntry {
  entry_type: "action";
  action_name: string;
  args: Record<string, unknown>;
  status: ActionStatus;
  error?: string;
  /** JPEG data URL of the environment after this action. */
  screenshot?: string;
  /**
   * The bridge request this action was sent as. The environment answers first
   * and photographs itself afterwards, so the picture arrives on a second
   * message; matching it back by request id is the only way to be sure it is
   * pinned to the action it shows, rather than to whichever turn happened to
   * be current when it landed.
   */
  requestId?: number;
  metadata: Record<string, unknown>;
}

export type TimelineEntry = ThinkingEntry | ResponseEntry | ActionEntry;

export interface EntryCounts {
  thinking: number;
  responses: number;
  actions: number;
}

export function countEntries(entries: TimelineEntry[]): EntryCounts {
  return entries.reduce<EntryCounts>(
    (counts, entry) => {
      if (entry.entry_type === "action") counts.actions += 1;
      else if (entry.entry_type === "model_thinking") counts.thinking += 1;
      else counts.responses += 1;
      return counts;
    },
    { thinking: 0, responses: 0, actions: 0 },
  );
}

export function usageOf(entries: TimelineEntry[]): {
  usage: Usage;
  cost: number;
  latencyMs: number;
} {
  return entries.reduce(
    (sum, entry) => {
      if (entry.entry_type !== "model_thinking") return sum;
      return {
        usage: {
          input: sum.usage.input + entry.usage.input,
          output: sum.usage.output + entry.usage.output,
          total: sum.usage.total + entry.usage.total,
        },
        cost: sum.cost + entry.cost,
        latencyMs: sum.latencyMs + entry.latencyMs,
      };
    },
    { usage: { input: 0, output: 0, total: 0 }, cost: 0, latencyMs: 0 },
  );
}

export function describeArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => {
      const text = String(value);
      return `${key}=${text.length > 32 ? `${text.slice(0, 32)}…` : text}`;
    })
    .join("  ");
}

export function isActionEntry(entry: TimelineEntry): entry is ActionEntry {
  return entry.entry_type === "action";
}
