/**
 * Reading one turn out of a model's reply.
 *
 * Models fence JSON, prefix it with prose, and occasionally emit two objects.
 * Extracting the first *balanced* object is more forgiving than JSON.parse on
 * the whole string, and less forgiving than a regex — which would stop at the
 * first closing brace, even one inside the model's own thought text.
 */

import type { Action } from "../environment/actions.ts";

/** One tool call, in the shape OpenRouter returns it. */
export interface ToolCall {
  id?: string;
  function?: { name?: unknown; arguments?: unknown };
}

/**
 * Read a turn out of a tool call, which is what a model is meant to reply with.
 *
 * The prose path below still exists and still runs, because a model that was
 * asked for a tool call and produced text is a measurement rather than an
 * error — but it is recorded as the fallback it is, not silently accepted as
 * equivalent. Which transport a turn arrived on is on the run record.
 */
export function fromToolCall(call: ToolCall): {
  action: Action | null;
  error?: string;
} {
  const name = call.function?.name;
  if (typeof name !== "string" || !name) return { action: null, error: "tool call has no name" };

  const raw = call.function?.arguments;
  // Providers disagree: most send a JSON *string*, some send the object. Both
  // are accepted, because rejecting one of them would report a working model as
  // broken for a reason that has nothing to do with the task.
  if (raw === undefined || raw === null || raw === "") return { action: { name, args: {} } };
  if (typeof raw === "object") return { action: { name, args: raw as Record<string, unknown> } };
  if (typeof raw !== "string") return { action: null, error: "tool arguments are not readable" };

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { action: { name, args: {} } };
    return { action: { name, args: parsed as Record<string, unknown> } };
  } catch (error) {
    return { action: null, error: `tool arguments are not valid JSON: ${String(error)}` };
  }
}

export function parseTurn(raw: string): {
  thought: string;
  action: Action | null;
  error?: string;
} {
  const candidate = firstObject(raw);
  if (!candidate) return { thought: "", action: null, error: "no JSON object found" };

  try {
    const parsed = JSON.parse(candidate) as {
      thought?: unknown;
      action?: { name?: unknown; args?: unknown };
    };
    const name = parsed.action?.name;
    if (typeof name !== "string") {
      return { thought: String(parsed.thought ?? ""), action: null, error: "no action name" };
    }
    return {
      thought: String(parsed.thought ?? ""),
      action: {
        name,
        args:
          parsed.action?.args && typeof parsed.action.args === "object"
            ? (parsed.action.args as Record<string, unknown>)
            : {},
      },
    };
  } catch (error) {
    // Truncated JSON is a model failure — it hit its output cap mid-object.
    // Recording it as one, rather than throwing, keeps it in the run where it
    // belongs instead of being logged as infrastructure.
    return { thought: "", action: null, error: `unparseable: ${String(error)}` };
  }
}

function firstObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
