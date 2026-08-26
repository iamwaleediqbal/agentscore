import { strict as assert } from "node:assert";
import { test } from "node:test";

import spec from "../lib/environment/vendor/polyact-coordinates.json" with { type: "json" };
import {
  declaredConvention,
  resolvePoint,
  type Convention,
  type Viewport,
} from "../lib/environment/computer.ts";

/**
 * This runner reads a coordinate the same way polyact does.
 *
 * polyact is the Python library in the repository next door that turns every
 * provider's computer-use output into one schema. It publishes its coordinate
 * rules as test vectors — `conformance/coordinates.json` — precisely so that a
 * second implementation can be held to them instead of claiming in a comment
 * that it "mirrors" the first.
 *
 * That claim is worth checking because the failure is silent. Read a 0-1000
 * grid answer as pixels and every click lands in the top-left quarter of the
 * screen; nothing raises, no request fails, and the run records a model that
 * appears unable to see. It cost a real paid run here before the rule existed.
 *
 * The vectors are vendored rather than imported, because these are two
 * repositories and TypeScript cannot read a Python package's data directory.
 * That makes drift possible, so the file is checked as well as used: its
 * declarations must agree with this runner's own table, which is the part that
 * would rot first.
 */

interface Vector {
  space: string;
  raw: { x: number; y: number };
  screen: { width: number; height: number };
  exact: { x: number; y: number };
  pixels: { x: number; y: number };
  why: string;
  grid?: { width: number; height: number; patch: number };
}

/** polyact's names for the spaces, in this runner's vocabulary. */
const AS_CONVENTION: Record<string, Convention | null> = {
  pixel: "pixels",
  normalized_1000: "grid1000",
  // Not implemented here, and deliberately. A fixed training canvas is a
  // property of a checkpoint served raw; every model this harness drives is
  // behind OpenRouter and answers in one of the other two. Skipped loudly
  // below rather than silently, so "we pass the spec" cannot come to mean
  // "we pass the parts of it we implemented".
  fixed_grid: null,
};

const viewportFor = (vector: Vector): Viewport => ({
  width: vector.screen.width,
  height: vector.screen.height,
  // The vectors describe a screenshot captured at the environment's own size,
  // which is also how this harness captures. Image pixels and CSS pixels are
  // separate axes here and the conversion between them is this runner's own
  // problem, not the spec's.
  imageWidth: vector.screen.width,
  imageHeight: vector.screen.height,
});

const vectors = spec.conversions as Vector[];

test("every polyact vector this runner implements converts identically", () => {
  const applicable = vectors.filter((v) => AS_CONVENTION[v.space]);
  assert.ok(applicable.length >= 8, "the spec should be exercising this, not decorating it");

  for (const vector of applicable) {
    const convention = AS_CONVENTION[vector.space]!;
    const resolved = resolvePoint(vector.raw.x, vector.raw.y, viewportFor(vector), convention);

    // Compared before rounding. This runner keeps sub-pixel positions because
    // it hands them to a browser that accepts them; polyact rounds and clamps
    // because it hands them to click drivers that do not. The spec separates
    // the two on purpose, and the shared part is the conversion.
    assert.ok(
      Math.abs(resolved.x - vector.exact.x) < 1e-9 &&
        Math.abs(resolved.y - vector.exact.y) < 1e-9,
      `${vector.space} ${JSON.stringify(vector.raw)} on ${vector.screen.width}x${vector.screen.height}: ` +
        `expected (${vector.exact.x}, ${vector.exact.y}), got (${resolved.x}, ${resolved.y}) — ${vector.why}`,
    );
    assert.equal(resolved.convention, convention, "an explicit convention is never overridden");
  }
});

test("the spaces this runner does not implement are skipped by name, not by accident", () => {
  const skipped = vectors.filter((v) => !AS_CONVENTION[v.space]);
  assert.deepEqual([...new Set(skipped.map((v) => v.space))], ["fixed_grid"]);
});

test("this runner's declaration table agrees with the spec's", () => {
  // The part most likely to rot. A model is added to one table and not the
  // other, and the disagreement shows up as a paid run clicking into space.
  for (const declaration of spec.declarations as { model: string; space: string | null }[]) {
    const expected = declaration.space ? AS_CONVENTION[declaration.space] : null;
    assert.equal(
      declaredConvention(declaration.model),
      expected,
      `${declaration.model}: polyact says ${declaration.space ?? "nothing is published"}`,
    );
  }
});

test("the far edge of a 0-1000 axis is the last pixel, not one past it", () => {
  // polyact clamps; this runner reports out of bounds and lets the caller
  // decide. Both refuse to hand a click driver a coordinate off the screen,
  // which is the property that actually matters.
  const resolved = resolvePoint(1000, 1000, viewportFor({
    screen: { width: 1920, height: 1080 },
  } as Vector), "grid1000");

  assert.equal(resolved.x, 1920);
  assert.equal(resolved.y, 1080);
  assert.equal(resolved.outOfBounds, false, "exactly on the edge is still on the screen");

  const past = resolvePoint(1001, 1001, viewportFor({
    screen: { width: 1920, height: 1080 },
  } as Vector), "grid1000");
  assert.equal(past.outOfBounds, true);
});

test("the vendored copy still says where it came from", () => {
  // A vendored file with no provenance is a file nobody knows how to refresh.
  const vendored = (spec as { _vendored?: { from?: string; path?: string } })._vendored;
  assert.equal(vendored?.from, "polyact");
  assert.equal(vendored?.path, "conformance/coordinates.json");
});
