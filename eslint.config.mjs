import tsParser from "@typescript-eslint/parser";
import base from "./packages/config-eslint/index.js";

export default [
  ...base,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
    },
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
];
