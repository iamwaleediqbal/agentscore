/**
 * Telling an assistant apart from a safety classifier.
 *
 * Guard models — Llama Guard and its relatives — do exactly one job: read some
 * text and emit a verdict about whether it is safe. Handed an agent prompt they
 * reply `User Safety: safe` and stop. They are free, they are listed in the
 * catalogue, and OpenRouter's free router is not bound by the capability filter
 * applied to named models, so it routes to one often enough to ruin a batch.
 *
 * Recording those turns as the agent failing to produce an action is the
 * mistake this exists to prevent. It is the same error as scoring a transport
 * failure: an absent measurement counted as a bad one. What answered was not
 * the kind of thing being measured.
 */

/** True when a reply is a moderation verdict rather than an attempt at the task. */
export function isClassifierVerdict(content: string): boolean {
  return /^(User Safety|Safety Categories)\s*:/i.test(content.trimStart().slice(0, 60));
}
