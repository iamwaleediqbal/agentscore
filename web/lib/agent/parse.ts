/**
 * Reading one turn out of a model's reply.
 *
 * Models fence JSON, prefix it with prose, and occasionally emit two objects.
 * Extracting the first *balanced* object is more forgiving than JSON.parse on
 * the whole string, and less forgiving than a regex — which would stop at the
 * first closing brace, even one inside the model's own thought text.
 */

import type { Action } from "../environment/actions.ts";

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
