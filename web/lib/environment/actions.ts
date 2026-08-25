/**
 * The action space.
 *
 * These are semantic actions against the application's own model, not pixel
 * clicks against a screenshot. That is a deliberate limit and it is worth being
 * straight about it: this gym measures whether a model can plan and follow
 * instructions in an application, not whether it can locate a button in an
 * image. A pixel-level gym needs a real browser driver and a machine to run it
 * on, and neither is free.
 *
 * Everything downstream of here would be identical either way, because grading
 * never looks at how a change was made.
 */

import { FOLDER_ORDER, type Email, type Folder, type MailState, clone } from "./state.ts";

export interface Action {
  name: string;
  args?: Record<string, unknown>;
}

export interface ApplyResult {
  state: MailState;
  ok: boolean;
  error?: string;
}

export const ACTION_NAMES = [
  "open_folder",
  "open",
  "search",
  "star",
  "unstar",
  "mark_read",
  "mark_unread",
  "archive",
  "trash",
  "spam",
  "not_spam",
  "restore",
  "delete_forever",
  "label",
  "compose",
  "reply",
  "forward",
  "send",
  "discard",
  "finish",
] as const;

/**
 * Whether a message survives the current filter.
 *
 * Exported because the interface and the reducer must agree exactly: a message
 * the list hides but the reducer still considers open would let an agent act on
 * something it cannot see.
 */
export function matchesQuery(email: Email, query: string | undefined): boolean {
  // Defensive because this is reached from a mailbox that may predate the
  // field. A restored state is data from another version of this app, and a
  // filter that throws takes the whole environment down with it.
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return true;
  return (
    email.from.toLowerCase().includes(q) ||
    email.subject.toLowerCase().includes(q) ||
    email.body.toLowerCase().includes(q)
  );
}

export function applyAction(state: MailState, action: Action): ApplyResult {
  const next = clone(state);
  const args = action.args ?? {};
  const id = typeof args.id === "string" ? args.id : undefined;

  const find = (): Email | undefined => next.emails.find((e) => e.id === id);

  switch (action.name) {
    /**
     * Filter the list. View state, not world state.
     *
     * Present because fourteen messages is more than fits on a screen, and an
     * agent that can only scroll is being tested on patience rather than on
     * whether it can find the thing it was asked about. Grading ignores the
     * query for the same reason it ignores which message is selected: it
     * changes what is visible and nothing about the mail.
     */
    /** Navigate. Without it a task about spam or drafts is unreachable. */
    case "open_folder": {
      const folder = String(args.folder ?? "") as Folder;
      if (!FOLDER_ORDER.includes(folder)) {
        return fail(state, `no folder named "${args.folder}"`);
      }
      next.folder = folder;
      // Switching folders closes whatever was open, as it does on screen.
      next.selectedId = null;
      return { ok: true, state: next };
    }

    case "search": {
      const query = typeof args.query === "string" ? args.query : "";
      next.query = query;
      // A filtered-out message cannot stay open, exactly as in the interface.
      const open = next.emails.find((e) => e.id === next.selectedId);
      if (open && !matchesQuery(open, query)) next.selectedId = null;
      return { ok: true, state: next };
    }

    case "open": {
      const email = find();
      if (!email) return fail(state, `no email with id ${id}`);
      // Opening marks read. Modelled because it is the most common source of
      // an unintended state change: an agent that opens three emails looking
      // for the right one has changed three read flags.
      email.read = true;
      next.selectedId = email.id;
      return { state: next, ok: true };
    }
    case "star":
    case "unstar": {
      const email = find();
      if (!email) return fail(state, `no email with id ${id}`);
      email.starred = action.name === "star";
      return { state: next, ok: true };
    }
    /**
     * Declared, and deliberately not performed.
     *
     * The interface has no "mark read" control — opening a message is how it
     * becomes read — so the reducer must not offer one either. The reducer is
     * the shared model both drivers consult, and it was quietly richer than the
     * screen: an agent driving it directly could mark a message read in a way
     * no person using this app can, while the same action through Chromium
     * failed as unknown. Three components, three different answers.
     */
    case "mark_read":
      return fail(state, "there is no mark-read control; opening a message marks it read");

    case "mark_unread": {
      const email = find();
      if (!email) return fail(state, `no email with id ${id}`);
      email.read = false;
      next.selectedId = email.id;
      return { state: next, ok: true };
    }
    /** File as junk. Reachable from the reading pane, so it implies opening. */
    case "spam": {
      const email = find();
      if (!email) return fail(state, `no email with id ${id}`);
      if (email.folder === "spam") return fail(state, "that message is already in spam");
      email.read = true;
      email.folder = "spam";
      next.selectedId = null;
      return { ok: true, state: next };
    }

    /** Rescue something filed as junk that was not. Returns it to the inbox. */
    case "not_spam": {
      const email = find();
      if (!email) return fail(state, `no email with id ${id}`);
      if (email.folder !== "spam") return fail(state, "that message is not in spam");
      email.read = true;
      email.folder = "inbox";
      next.selectedId = null;
      return { ok: true, state: next };
    }

    /** Put something back where it came from. Trash only. */
    case "restore": {
      const email = find();
      if (!email) return fail(state, `no email with id ${id}`);
      if (email.folder !== "trash") return fail(state, "only a message in trash can be restored");
      email.read = true;
      email.folder = "inbox";
      next.selectedId = null;
      return { ok: true, state: next };
    }

    /**
     * Gone, with no undo — and only from the two folders that offer it.
     *
     * Restricted deliberately. A permanent delete reachable from the inbox
     * would make several tasks failable in a way no interface actually allows,
     * and "it deleted my mail" is the one outcome an evaluation must never
     * enable by accident.
     */
    case "delete_forever": {
      const email = find();
      if (!email) return fail(state, `no email with id ${id}`);
      if (email.folder !== "spam" && email.folder !== "trash") {
        return fail(state, "permanent delete is only offered in spam and trash");
      }
      next.emails = next.emails.filter((e) => e.id !== email.id);
      next.selectedId = null;
      return { ok: true, state: next };
    }

    case "archive":
    case "trash": {
      const email = find();
      if (!email) return fail(state, `no email with id ${id}`);
      // Reachable only from the reading pane, so reaching it implies opening.
      email.read = true;
      email.folder = action.name === "archive" ? "archive" : "trash";
      if (next.selectedId === email.id) next.selectedId = null;
      return { state: next, ok: true };
    }
    case "label": {
      const email = find();
      if (!email) return fail(state, `no email with id ${id}`);
      /*
       * Lower-cased, because a label is a name and not a sentence.
       *
       * Asked to label something "finance", a model will sometimes write
       * "Finance". It has done the task. Grading that as a required change that
       * never happened is the grader being wrong about the model rather than
       * the model being wrong about the mailbox — and no mail client would let
       * "finance" and "Finance" exist side by side either.
       */
      const name = String(args.name ?? "").trim().toLowerCase();
      if (!name) return fail(state, "label needs a name");
      if (!email.labels.includes(name)) email.labels.push(name);
      email.labels.sort();
      return { state: next, ok: true };
    }
    case "compose": {
      next.composer = {
        to: String(args.to ?? ""),
        subject: String(args.subject ?? ""),
        body: String(args.body ?? ""),
      };
      return { state: next, ok: true };
    }
    case "reply": {
      const email = find();
      if (!email) return fail(state, `no email with id ${id}`);
      email.read = true;
      next.selectedId = email.id;
      next.composer = {
        to: email.from,
        subject: email.subject.startsWith("Re: ")
          ? email.subject
          : `Re: ${email.subject}`,
        body: String(args.body ?? ""),
      };
      return { state: next, ok: true };
    }
    /**
     * Declared so an agent can discover it is unavailable, never performed.
     *
     * This is the whole point of the `no-forward-control` task: the obvious
     * move has no control in this interface, and an agent has to notice that
     * and find the route that exists. The reducer used to perform it anyway,
     * which made the task trivially passable through the in-page harness and
     * impossible through Chromium — the same task, two different worlds.
     */
    case "forward":
      return fail(state, "this interface has no forward control");

    case "send": {
      if (!next.composer) return fail(state, "nothing to send");
      if (!next.composer.to.trim()) return fail(state, "no recipient");

      /*
       * The id is searched for, not computed from the length.
       *
       * `sent-${length + 1}` collides the moment anything has been deleted:
       * send once at 52 messages and the copy is `sent-53`; delete one and send
       * again and the length is 52 once more, so the second copy is `sent-53`
       * as well. Two messages then share an id, and `find` returns whichever
       * comes first — so every later action lands on the wrong message, and the
       * grader reports a change against mail the agent never touched.
       *
       * Deliberately a scan rather than a random or time-based id: a run has to
       * replay to the same state, or the recorded trajectory stops matching the
       * one the console shows.
       */
      let n = next.emails.length + 1;
      while (next.emails.some((e) => e.id === `sent-${n}`)) n++;

      next.emails.push({
        id: `sent-${n}`,
        from: "you@clickmail.example",
        to: next.composer.to,
        subject: next.composer.subject,
        body: next.composer.body,
        receivedAt: "2026-08-24T00:00:00Z",
        folder: "sent",
        read: true,
        starred: false,
        labels: [],
      });
      next.composer = null;
      return { state: next, ok: true };
    }
    case "discard": {
      next.composer = null;
      return { state: next, ok: true };
    }
    case "finish":
      return { state: next, ok: true };
    default:
      return fail(state, `unknown action ${action.name}`);
  }
}

function fail(state: MailState, error: string): ApplyResult {
  // The state is returned unchanged rather than partially mutated. A failed
  // action that half-applies is the worst outcome available: the run continues
  // from a world nobody described.
  return { state, ok: false, error };
}
