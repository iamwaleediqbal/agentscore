/**
 * How the mail app describes itself to a grader.
 *
 * This is the whole of what the harness needs to know about this application:
 * how to flatten a mailbox to leaf paths, which of those move on their own,
 * and how to tell which message a path belongs to. Everything else about
 * grading — the two diffs, the four verdicts, what counts as overreach —
 * lives in the harness and knows nothing about mail.
 *
 * The file is small on purpose. Its size is the claim: pointing the harness at
 * another application, including a real one, is writing another one of these.
 */

import type { Describable } from "../harness/grade.ts";
import type { MailState } from "./state.ts";

/**
 * A message's stable identity.
 *
 * Not the array index and not the id. Index-based paths look fine until a
 * message moves folder or one is sent, at which point every message after it
 * renumbers and a single action reports forty changes. The id is generated, so
 * it cannot match between a golden state and a live one. What survives both is
 * the pair that describes the message rather than its position: who it is from
 * and what it is about.
 */
function keyOf(email: { from: string; subject: string }): string {
  return `${email.from} | ${email.subject}`;
}

export const MAILBOX: Describable<MailState> = {
  id: "clickmail-mailbox",

  /*
   * Ids and timestamps of generated mail cannot match between two runs.
   * `selectedId` and `query` are view state: they change what is on screen and
   * nothing about the mail, and counting them would mark every agent that
   * looked before acting as having changed something nobody asked for.
   */
  volatile: [/\.id$/, /\.receivedAt$/, /^selectedId$/, /^query$/],

  /*
   * Reading a message you were asked to act on is not part of the task and not
   * a mistake either. Requiring it fails an agent that took a legitimate
   * shortcut; penalising it fails one that simply looked before acting.
   */
  incidentalSuffix: ".read",

  /**
   * The `email(from | subject)` part of a leaf path.
   *
   * Taken from the closing bracket rather than by stripping a trailing
   * `.field`, because not every leaf is one segment deep: a label lives at
   * `email(…).labels.finance`, and stripping the last segment there yields
   * `email(…).labels`, which matches no message and quietly stops the
   * incidental-read rule from firing.
   */
  subjectOf(path: string): string {
    const end = path.lastIndexOf(")");
    return end === -1 ? path : path.slice(0, end + 1);
  },

  flatten(state: MailState): Map<string, unknown> {
    const out = new Map<string, unknown>();
    const seen = new Map<string, number>();

    for (const email of [...state.emails].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))) {
      // Two messages can legitimately share a sender and subject, so repeats
      // get a suffix rather than silently overwriting each other.
      const base = keyOf(email);
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      const prefix = `email(${base}${count > 1 ? ` #${count}` : ""})`;

      out.set(`${prefix}.id`, email.id);
      out.set(`${prefix}.to`, email.to);
      out.set(`${prefix}.body`, email.body);
      out.set(`${prefix}.receivedAt`, email.receivedAt);
      out.set(`${prefix}.folder`, email.folder);
      out.set(`${prefix}.read`, email.read);
      out.set(`${prefix}.starred`, email.starred);

      /*
       * One path per label, not one path for the list.
       *
       * Joined into a single value, "finance" and "finance|urgent" differ on
       * the same path — so an agent that applied the label it was asked for and
       * then added one of its own read as though it had never labelled anything
       * at all. It had done the task and then done more, and describing the two
       * as one value left the harness no way to tell those apart.
       */
      for (const label of email.labels) {
        out.set(`${prefix}.labels.${label}`, true);
      }
    }

    out.set("selectedId", state.selectedId);
    out.set("composer", state.composer ? JSON.stringify(state.composer) : null);
    return out;
  },
};
