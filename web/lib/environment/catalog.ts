/**
 * One description of the action space, consumed by everything that describes it.
 *
 * There were three: the prompt handed to the model, the reference table on the
 * Tools page, and the reducer itself. They drifted, and each drift cost a paid
 * run to discover — the prompt listed `mark_read` and `forward`, which the
 * reducer refuses, and omitted `spam`, `not_spam`, `restore` and
 * `delete_forever` entirely. An agent asked to rescue a message from spam was
 * never told the action for it existed, so it improvised with `archive` and was
 * marked down for the harness's omission.
 *
 * `Record<ActionName, ...>` is the point: adding an action to the reducer
 * without describing it here does not compile.
 */

import type { ACTION_NAMES } from "./actions.ts";
import { FOLDER_ORDER } from "./state.ts";

export type ActionName = (typeof ACTION_NAMES)[number];

/** Where a control lives. `none` means it is declared but does not exist. */
export type Reach = "list" | "reading pane" | "composer" | "global" | "none";

/**
 * One argument, described well enough to become a JSON Schema.
 *
 * `args` used to be a display string — `'"id", "name"'` — which was fine while
 * the only consumer was a table for a human to read. It is not enough to build
 * a tool schema from, and a second hand-written list of the same arguments in
 * schema form is exactly the drift this file exists to prevent. So the
 * arguments are described once, properly, and both the table and the schema are
 * derived from them.
 */
export interface Param {
  name: string;
  type: "string" | "number";
  description: string;
  /** A closed set, when the argument has one. Providers enforce it. */
  enum?: readonly string[];
  /** Omissible. `compose` with no arguments opens an empty draft. */
  optional?: true;
}

export interface ActionDoc {
  params: readonly Param[];
  reach: Reach;
  effect: string;
  /**
   * How many pointer interactions this action costs in computer use, once the
   * message it acts on is already on screen.
   *
   * One semantic action is not one turn when the model is driving pixels.
   * `label` is a click into a field, the text, and a click on Add — three
   * turns for the one call a tool-calling model makes. Recorded here so the
   * turn budget can be derived from it rather than guessed, because a budget
   * guessed too low measures arithmetic instead of the model.
   */
  clicks: number;
}

export const CATALOG: Record<ActionName, ActionDoc> = {
  open_folder: {
    params: [
      {
        name: "folder",
        type: "string",
        description: "Which folder to show.",
        enum: FOLDER_ORDER,
      },
    ],
    reach: "global",
    effect: "Switches folder: inbox, drafts, outbox, sent, spam, archive, trash.",
    clicks: 1,
  },
  open: {
    params: [{ name: "id", type: "string", description: "The id of the message, exactly as shown in the mailbox." }],
    reach: "list",
    effect: "Opens a message and marks it read.",
    clicks: 1,
  },
  search: {
    params: [
      {
        name: "query",
        type: "string",
        description: "Text to match against sender, subject or body. An empty string clears the search.",
      },
    ],
    reach: "list",
    effect: "Filters the open folder by sender, subject or body. An empty query clears it.",
    clicks: 2,
  },
  star: {
    params: [{ name: "id", type: "string", description: "The id of the message, exactly as shown in the mailbox." }],
    reach: "list",
    effect: "Stars a message. Does not open it.",
    clicks: 1,
  },
  unstar: {
    params: [{ name: "id", type: "string", description: "The id of the message, exactly as shown in the mailbox." }],
    reach: "list",
    effect: "Removes a star.",
    clicks: 1,
  },
  mark_read: {
    params: [{ name: "id", type: "string", description: "The id of the message, exactly as shown in the mailbox." }],
    reach: "none",
    effect: "No control exists. Opening a message is how it becomes read.",
    clicks: 1,
  },
  mark_unread: {
    params: [{ name: "id", type: "string", description: "The id of the message, exactly as shown in the mailbox." }],
    reach: "reading pane",
    effect: "Marks a message unread.",
    clicks: 1,
  },
  archive: {
    params: [{ name: "id", type: "string", description: "The id of the message, exactly as shown in the mailbox." }],
    reach: "reading pane",
    effect: "Moves to archive. Implies opening.",
    clicks: 1,
  },
  trash: {
    params: [{ name: "id", type: "string", description: "The id of the message, exactly as shown in the mailbox." }],
    reach: "reading pane",
    effect: "Moves to trash. Implies opening.",
    clicks: 1,
  },
  spam: {
    params: [{ name: "id", type: "string", description: "The id of the message, exactly as shown in the mailbox." }],
    reach: "reading pane",
    effect: "Files a message as spam. Not offered for mail already in spam or trash.",
    clicks: 1,
  },
  not_spam: {
    params: [{ name: "id", type: "string", description: "The id of the message, exactly as shown in the mailbox." }],
    reach: "reading pane",
    effect: "Moves a message out of spam and back to the inbox.",
    clicks: 1,
  },
  restore: {
    params: [{ name: "id", type: "string", description: "The id of the message, exactly as shown in the mailbox." }],
    reach: "reading pane",
    effect: "Moves a message out of trash and back to the inbox.",
    clicks: 1,
  },
  delete_forever: {
    params: [{ name: "id", type: "string", description: "The id of the message, exactly as shown in the mailbox." }],
    reach: "reading pane",
    effect: "Deletes permanently, with no undo. Offered only in spam and trash.",
    clicks: 1,
  },
  label: {
    params: [
      { name: "id", type: "string", description: "The id of the message, exactly as shown in the mailbox." },
      { name: "name", type: "string", description: "The label to add. Stored lower-cased." },
    ],
    reach: "reading pane",
    effect: "Adds a label, lower-cased. Implies opening.",
    clicks: 3,
  },
  compose: {
    params: [
      { name: "to", type: "string", description: "Recipient address.", optional: true },
      { name: "subject", type: "string", description: "Subject line.", optional: true },
      { name: "body", type: "string", description: "Message body.", optional: true },
    ],
    reach: "global",
    effect: "Opens a draft, filling in whatever is given.",
    clicks: 4,
  },
  reply: {
    params: [
      { name: "id", type: "string", description: "The message being replied to." },
      { name: "body", type: "string", description: "The reply text.", optional: true },
    ],
    reach: "reading pane",
    effect: "Opens a draft addressed to the sender.",
    clicks: 2,
  },
  forward: {
    params: [
      { name: "id", type: "string", description: "The message to forward." },
      { name: "to", type: "string", description: "Where to forward it." },
    ],
    reach: "none",
    effect: "No control exists. Declared so an agent can discover it is unavailable.",
    clicks: 1,
  },
  send: {
    params: [],
    reach: "composer",
    effect: "Sends the open draft. Fails with no recipient.",
    clicks: 1,
  },
  save_draft: {
    params: [],
    reach: "composer",
    effect: "Files the open draft in Drafts and closes the composer.",
    clicks: 1,
  },
  discard: {
    params: [],
    reach: "composer",
    effect: "Throws the draft away.",
    clicks: 1,
  },
  finish: {
    params: [],
    reach: "global",
    effect: "Ends the run. The agent is claiming it is done.",
    clicks: 1,
  },
};

/**
 * The argument list as a person reads it: `"id", "name"`, or `—` for none.
 *
 * Takes anything carrying `params` rather than a whole ActionDoc, because the
 * computer-use actions have the same arguments and none of the rest — no reach,
 * no click cost — and both tables render this same column.
 */
export function argsOf(doc: { params: readonly Param[] }): string {
  return doc.params.length ? doc.params.map((p) => `"${p.name}"`).join(", ") : "—";
}

/**
 * The action space as JSON Schema, which is how a model is actually told about
 * it.
 *
 * `openrouter.ai/models?supported_parameters=tools` is how the catalogue says
 * which models can receive this, and the model filter uses exactly that field.
 *
 * The prompt used to describe the actions in prose and ask for a JSON object
 * back in the message text, which the runner then dug out with a brace matcher.
 * That is not tool calling, and calling the mode "tool calling" while doing it
 * was the plainest thing wrong with this harness. It also invented a failure
 * that need not exist: a reply truncated at the output cap arrived as
 * `{"thought": "…", "acti` and was recorded as a model that cannot produce
 * JSON, when it was a model that ran out of room mid-sentence.
 *
 * Generated from the same CATALOG the reducer and the reference table read, so
 * the schema cannot describe an action the reducer will refuse.
 */
export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required: string[];
      additionalProperties: false;
    };
  };
}

export function toolSchemas(): ToolSchema[] {
  return (Object.keys(CATALOG) as ActionName[]).map((name) => {
    const doc = CATALOG[name];
    const properties: ToolSchema["function"]["parameters"]["properties"] = {};
    const required: string[] = [];

    for (const param of doc.params) {
      properties[param.name] = {
        type: param.type,
        description: param.description,
        ...(param.enum ? { enum: [...param.enum] } : {}),
      };
      if (!param.optional) required.push(param.name);
    }

    return {
      type: "function",
      function: {
        name,
        // An unreachable action is still offered, and still says so. Discovering
        // that a capability does not exist is one of the tasks, so removing it
        // from the schema would remove the thing being measured.
        description:
          doc.reach === "none"
            ? `${doc.effect} NOT AVAILABLE in this interface — calling it will fail.`
            : doc.effect,
        parameters: { type: "object", properties, required, additionalProperties: false },
      },
    };
  });
}

/** The action list as the model is shown it, generated so it cannot drift. */
export function actionReference(): string {
  const names = Object.keys(CATALOG) as ActionName[];
  const width = Math.max(...names.map((n) => n.length));

  return names
    .map((name) => {
      const doc = CATALOG[name];
      const spec = argsOf(doc);
      const args = spec === "—" ? "{}" : `{${spec}}`;
      const note = doc.reach === "none" ? "  — NOT AVAILABLE in this interface" : "";
      return `  ${name.padEnd(width)} ${args.padEnd(30)}${doc.effect}${note}`;
    })
    .join("\n");
}
