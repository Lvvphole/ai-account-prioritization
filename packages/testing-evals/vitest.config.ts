import { defineConfig } from "vitest/config";

/**
 * Vitest config for the eval package.
 *
 * Includes both *.eval.ts (deterministic) and *.judge.eval.ts (async judge).
 * The two are separated at the script level (see package.json):
 *   - test:evals  -> runs *.eval.ts, EXCLUDES *.judge.eval.ts
 *   - test:judge  -> runs only *.judge.eval.ts
 * Playwright specs (*.test.ts) are intentionally NOT matched here; they run
 * under Playwright, not Vitest.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.eval.ts"],
    exclude: ["node_modules", "dist", "eval-results"],
    environment: "node",
    reporters: ["default"],
    passWithNoTests: false,
  },
});
