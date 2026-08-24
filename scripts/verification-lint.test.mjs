import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();
const fixtureRoot = path.join(root, "verification-reports", "lint-fixtures");

function lint() {
  return spawnSync("pnpm", ["lint"], { cwd: root, encoding: "utf8" });
}

function resetFixtures() {
  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(fixtureRoot, { recursive: true });
}

test("root lint parses TypeScript and enforces no-debugger across repository scope", () => {
  resetFixtures();
  try {
    const clean = lint();
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);

    writeFileSync(
      path.join(fixtureRoot, "valid.ts"),
      "export type Foo = { bar: string };\n",
    );
    writeFileSync(
      path.join(fixtureRoot, "valid.tsx"),
      "const App = () => <div>ok</div>; export default App;\n",
    );
    const valid = lint();
    assert.equal(valid.status, 0, valid.stdout + valid.stderr);

    writeFileSync(path.join(fixtureRoot, "violation.ts"), "debugger;\n");
    const violation = lint();
    assert.notEqual(violation.status, 0, "debugger must make root lint fail");

    rmSync(path.join(fixtureRoot, "violation.ts"));
    const ignoredDir = path.join(fixtureRoot, "dist");
    mkdirSync(ignoredDir, { recursive: true });
    writeFileSync(path.join(ignoredDir, "ignored.ts"), "debugger;\n");
    const ignored = lint();
    assert.equal(ignored.status, 0, ignored.stdout + ignored.stderr);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("root lint is one direct repository-wide ESLint command", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts.lint, "eslint --max-warnings=0 .");
});
