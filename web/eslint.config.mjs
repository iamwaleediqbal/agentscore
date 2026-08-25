import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Build output, dependencies, and directories a stale build or a deleted
    // file was moved aside into. Without these, `eslint .` reports thousands of
    // problems in generated code and drowns the handful that are real.
    ignores: [
      ".next/**",
      ".next-stale*/**",
      "_to_delete/**",
      "node_modules/**",
      "runner/node_modules/**",
      "next-env.d.ts",
    ],
  },
];

export default config;
