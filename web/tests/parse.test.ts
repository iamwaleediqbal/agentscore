import { strict as assert } from "node:assert";
import { test } from "node:test";

import { parseTurn } from "../lib/agent/parse.ts";

test("reads a clean reply", () => {
  const result = parseTurn('{"thought": "star it", "action": {"name": "star", "args": {"id": "m1"}}}');
  assert.equal(result.action!.name, "star");
  assert.equal(result.action!.args!.id, "m1");
  assert.equal(result.thought, "star it");
});

test("survives a markdown fence", () => {
  const raw = '```json\n{"thought": "ok", "action": {"name": "finish"}}\n```';
  assert.equal(parseTurn(raw).action!.name, "finish");
});

test("survives prose before the object", () => {
  const raw = 'Sure, I will star it.\n{"thought": "t", "action": {"name": "star", "args": {"id": "m1"}}}';
  assert.equal(parseTurn(raw).action!.name, "star");
});

test("braces inside a thought do not end the object early", () => {
  // A regex up to the first closing brace gets this wrong.
  const raw = '{"thought": "the body says {see attached}", "action": {"name": "finish"}}';
  const result = parseTurn(raw);
  assert.equal(result.action!.name, "finish");
  assert.match(result.thought, /see attached/);
});

test("escaped quotes inside a string do not end it early", () => {
  const raw = '{"thought": "it said \\"pay now\\"", "action": {"name": "finish"}}';
  assert.equal(parseTurn(raw).action!.name, "finish");
});

test("narration with no action is reported, not thrown", () => {
  const result = parseTurn("First I would open the email, then I would star it.");
  assert.equal(result.action, null);
  assert.match(result.error!, /no JSON object/);
});

test("truncated JSON is a model failure with a reason", () => {
  const result = parseTurn('{"thought": "star it", "action": {"name": "star", "args": {"id"');
  assert.equal(result.action, null);
  assert.ok(result.error);
});

test("an object with no action name is rejected", () => {
  const result = parseTurn('{"thought": "done", "action": {}}');
  assert.equal(result.action, null);
  assert.match(result.error!, /no action name/);
});

test("missing args default to empty rather than undefined", () => {
  assert.deepEqual(parseTurn('{"action": {"name": "send"}}').action!.args, {});
});
