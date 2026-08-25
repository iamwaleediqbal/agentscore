/**
 * Read one variable out of .env.local without sourcing the file.
 *
 * Sourcing a dotenv from bash executes whatever is in it, and the quoting
 * needed to strip quotes with sed is worse than the problem. Node is already a
 * hard requirement here, so it does the parsing.
 *
 *   node runner/read-env.mjs OPENROUTER_API_KEY
 */

import { readFileSync } from "node:fs";

const name = process.argv[2];
if (!name) {
  process.stderr.write("usage: read-env.mjs VARIABLE_NAME\n");
  process.exit(2);
}

let text = "";
try {
  text = readFileSync(process.argv[3] ?? ".env.local", "utf8");
} catch {
  process.exit(1);
}

const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
const line = text.split(/\r?\n/).find((candidate) => pattern.test(candidate));
if (!line) process.exit(1);

let value = line.replace(pattern, "").trim();
const quoted =
  (value.startsWith('"') && value.endsWith('"')) ||
  (value.startsWith("'") && value.endsWith("'"));
if (quoted && value.length >= 2) value = value.slice(1, -1);

process.stdout.write(value);
