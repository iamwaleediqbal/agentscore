/**
 * The tool-calling observation: the application describing itself.
 *
 * Worth being precise about what this is, because it resembles something it is
 * not. A browser-agent benchmark — WebArena, BrowserGym — gives a text agent
 * the page's *accessibility tree*, extracted from what is rendered, and exposes
 * no internal state at all. This is the other integration pattern: the
 * application handing an agent a structured view of itself and a set of named
 * operations, which is what an MCP server does.
 *
 * Both are real and current. They are not the same measurement, and presenting
 * this as a browser-agent baseline would be a category error — the gap between
 * it and computer use includes the whole integration model, not just the
 * absence of pixels.
 *
 * One folder at a time, because that is the screen a mail client shows and
 * because rendering all seven cost about three thousand tokens of mail nobody
 * was looking at.
 *
 * Bodies are truncated except for the open message. A model that needs the full
 * text can open it, and paying for fifty bodies on every turn of every attempt
 * is how a free quota disappears before lunch.
 */

import { matchesQuery } from "./actions.ts";
import { actionReference } from "./catalog.ts";
import { FOLDER_ORDER, type MailState } from "./state.ts";

const BODY_PREVIEW = 140;

export function serialize(state: MailState): string {
  const lines: string[] = [];

  /*
   * One folder, the way a mail client shows one folder.
   *
   * Rendering all seven every turn cost about three thousand tokens, most of
   * them mail nobody was looking at, and described a screen that does not
   * exist. The agent sees the folder it has open, plus how much is in the
   * others so it knows where to go next.
   */
  const counts = FOLDER_ORDER.map((folder) => {
    const all = state.emails.filter((e) => e.folder === folder);
    const unread = all.filter((e) => !e.read).length;
    return `${folder} ${all.length}${unread ? ` (${unread} unread)` : ""}`;
  }).join(" · ");

  lines.push(`## folders: ${counts}`);
  lines.push(`## open folder: ${state.folder}`);

  if (state.query) {
    // Said plainly, because a short list is otherwise indistinguishable from a
    // folder that simply does not contain what the agent is looking for.
    lines.push(`## search active: "${state.query}" — only matching mail is listed`);
  }
  lines.push("");

  const emails = state.emails.filter(
    (e) => e.folder === state.folder && matchesQuery(e, state.query),
  );

  if (!emails.length) {
    lines.push(state.query ? "(nothing matches that search)" : "(this folder is empty)");
  }

  for (const email of emails) {
    const flags = [
      email.read ? "read" : "unread",
      email.starred ? "starred" : null,
      email.labels.length ? `labels=${email.labels.join(",")}` : null,
      state.selectedId === email.id ? "open" : null,
    ]
      .filter(Boolean)
      .join(" ");

    lines.push(`[${email.id}] from=${email.from} to=${email.to}`);
    lines.push(`  subject: ${email.subject || "(no subject)"}`);
    lines.push(`  ${flags}`);

    // The full body only for the message that is open. Everything else gets a
    // preview, because paying for fifty bodies on every turn of every attempt
    // is how a free quota disappears before lunch.
    const body =
      state.selectedId === email.id
        ? email.body
        : email.body.slice(0, BODY_PREVIEW) +
          (email.body.length > BODY_PREVIEW ? "..." : "");
    lines.push(`  body: ${body.replace(/\n+/g, " ") || "(empty)"}`);
  }

  lines.push("");
  if (state.composer) {
    lines.push("## composer (unsent)");
    lines.push(`  to: ${state.composer.to}`);
    lines.push(`  subject: ${state.composer.subject}`);
    lines.push(`  body: ${state.composer.body || "(empty)"}`);
  } else {
    lines.push("## composer: closed");
  }

  return lines.join("\n").trim();
}

export const SYSTEM_PROMPT = `You are operating an email client.

Reply with exactly one JSON object and nothing else:
{"thought": "one short sentence", "action": {"name": "...", "args": {...}}}

Actions:
${actionReference()}

Rules:
  One action per reply.
  Opening an email marks it read. That is a change to the mailbox.
  Actions marked NOT AVAILABLE will always fail. Find another route.
  Do only what the task asks. Extra tidying counts against you.
  Call finish when the task is complete.`;
