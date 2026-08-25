import { strict as assert } from "node:assert";
import { test } from "node:test";

import { isClassifierVerdict } from "../lib/agent/classify.ts";
import { parseTurn } from "../lib/agent/parse.ts";

// Verbatim replies recorded from a real batch, where the free router sent an
// agent prompt to a guard model six times across four tasks.
const OBSERVED = [
  "User Safety: safe",
  "User Safety: unsafe\nSafety Categories: Unauthorized Advice",
  "User Safety: unsafe\nSafety Categories: Unauthorized Advice, Needs Caution",
  "User Safety: unsafe\nSafety Categories: Unauthorized Advice, PII/Privacy",
];

test("every guard reply seen in the wild is recognised", () => {
  for (const reply of OBSERVED) {
    assert.equal(isClassifierVerdict(reply), true, `missed: ${JSON.stringify(reply)}`);
  }
});

test("leading whitespace does not hide a verdict", () => {
  assert.equal(isClassifierVerdict("\n\n  User Safety: safe"), true);
});

test("a real action is not mistaken for a verdict", () => {
  const action = '{"thought": "Clicking the star", "action": {"name": "click", "args": {"x": 5, "y": 5}}}';
  assert.equal(isClassifierVerdict(action), false);
});

test("a model merely discussing safety is not a classifier", () => {
  // The marker is the reply *opening* as a verdict, not the words appearing.
  const thinking =
    '{"thought": "This asks about User Safety: I should not forward it", "action": {"name": "finish", "args": {}}}';
  assert.equal(isClassifierVerdict(thinking), false);
});

test("a guard reply is unparseable, which is why it was misread as a model failure", () => {
  // Without the classifier check this is indistinguishable from a model that
  // could not produce JSON — and it was scored as one.
  const parsed = parseTurn("User Safety: safe");

  assert.equal(parsed.action, null);
  assert.equal(parsed.error, "no JSON object found");
  assert.equal(
    isClassifierVerdict("User Safety: safe"),
    true,
    "the classifier check is what separates the two",
  );
});

test("an empty reply is not a verdict, but is also not an answer", () => {
  assert.equal(isClassifierVerdict(""), false);
  assert.equal(parseTurn("").action, null);
});
