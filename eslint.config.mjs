import base from "./packages/config-eslint/index.js";
import tsparser from "@typescript-eslint/parser";

export default [
  ...base,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
];
