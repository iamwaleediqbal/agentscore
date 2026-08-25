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

export type ActionName = (typeof ACTION_NAMES)[number];

/** Where a control lives. `none` means it is declared but does not exist. */
export type Reach = "list" | "reading pane" | "composer" | "global" | "none";

export interface ActionDoc {
  args: string;
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
    args: '"folder"',
    reach: "global",
    effect: "Switches folder: inbox, drafts, outbox, sent, spam, archive, trash.",
    clicks: 1,
  },
  open: { args: '"id"', reach: "list", effect: "Opens a message and marks it read.", clicks: 1 },
  search: {
    args: '"query"',
    reach: "list",
    effect: "Filters the open folder by sender, subject or body. An empty query clears it.",
    clicks: 2,
  },
  star: { args: '"id"', reach: "list", effect: "Stars a message. Does not open it.", clicks: 1 },
  unstar: { args: '"id"', reach: "list", effect: "Removes a star.", clicks: 1 },
  mark_read: {
    args: '"id"',
    reach: "none",
    effect: "No control exists. Opening a message is how it becomes read.",
    clicks: 1,
  },
  mark_unread: { args: '"id"', reach: "reading pane", effect: "Marks a message unread.", clicks: 1 },
  archive: { args: '"id"', reach: "reading pane", effect: "Moves to archive. Implies opening.", clicks: 1 },
  trash: { args: '"id"', reach: "reading pane", effect: "Moves to trash. Implies opening.", clicks: 1 },
  spam: {
    args: '"id"',
    reach: "reading pane",
    effect: "Files a message as spam. Not offered for mail already in spam or trash.",
    clicks: 1,
  },
  not_spam: {
    args: '"id"',
    reach: "reading pane",
    effect: "Moves a message out of spam and back to the inbox.",
    clicks: 1,
  },
  restore: {
    args: '"id"',
    reach: "reading pane",
    effect: "Moves a message out of trash and back to the inbox.",
    clicks: 1,
  },
  delete_forever: {
    args: '"id"',
    reach: "reading pane",
    effect: "Deletes permanently, with no undo. Offered only in spam and trash.",
    clicks: 1,
  },
  label: {
    args: '"id", "name"',
    reach: "reading pane",
    effect: "Adds a label, lower-cased. Implies opening.",
    clicks: 3,
  },
  compose: { args: '"to", "subject", "body"', reach: "global", effect: "Opens a blank draft.", clicks: 4 },
  reply: {
    args: '"id", "body"',
    reach: "reading pane",
    effect: "Opens a draft addressed to the sender.",
    clicks: 2,
  },
  forward: {
    args: '"id", "to"',
    reach: "none",
    effect: "No control exists. Declared so an agent can discover it is unavailable.",
    clicks: 1,
  },
  send: { args: "—", reach: "composer", effect: "Sends the open draft. Fails with no recipient.", clicks: 1 },
  discard: { args: "—", reach: "composer", effect: "Throws the draft away.", clicks: 1 },
  finish: { args: "—", reach: "global", effect: "Ends the run. The agent is claiming it is done.", clicks: 1 },
};

/** The action list as the model is shown it, generated so it cannot drift. */
export function actionReference(): string {
  const names = Object.keys(CATALOG) as ActionName[];
  const width = Math.max(...names.map((n) => n.length));

  return names
    .map((name) => {
      const doc = CATALOG[name];
      const args = doc.args === "—" ? "{}" : `{${doc.args}}`;
      const note = doc.reach === "none" ? "  — NOT AVAILABLE in this interface" : "";
      return `  ${name.padEnd(width)} ${args.padEnd(30)}${doc.effect}${note}`;
    })
    .join("\n");
}
