/**
 * Shared ESLint flat-config base for the monorepo.
 *
 * Kept dependency-light on purpose: linting is advisory in this repo and must
 * never block the deterministic verification gates (typecheck / evals / build).
 * Packages can extend this and layer framework-specific rules on top.
 *
 * @type {import("eslint").Linter.Config[]}
 */
module.exports = [
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/generated/**",
      "**/node_modules/**",
      "**/eval-results/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-console": "off",
      "no-debugger": "error",
    },
  },
];
