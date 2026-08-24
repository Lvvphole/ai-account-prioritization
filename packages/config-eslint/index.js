/** @type {import("eslint").Linter.Config[]} */
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
