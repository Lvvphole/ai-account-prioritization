import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const requiredFiles = [
  "AGENTS.md",
  "docs/ARCHITECTURE.md",
  "docs/VERIFICATION.md",
  "docs/RELIABILITY.md",
  "docs/SECURITY.md",
  "docs/PLANS.md",
  "docs/QUALITY_SCORE.md",
  "docs/design-docs/core-beliefs.md",
  "docs/design-docs/index.md",
  "docs/decisions/ADR-002-harness-economics-and-minimum-sufficient-control.md",
  "docs/decisions/ADR-003-event-driven-crm-ingestion-and-notifications.md",
];

const canonicalMetadataFiles = [
  "docs/ARCHITECTURE.md",
  "docs/VERIFICATION.md",
  "docs/RELIABILITY.md",
  "docs/SECURITY.md",
  "docs/PLANS.md",
  "docs/QUALITY_SCORE.md",
  "docs/design-docs/core-beliefs.md",
  "docs/design-docs/index.md",
];

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    failures.push(`missing required repository knowledge file: ${relativePath}`);
  }
}

const agentsPath = path.join(root, "AGENTS.md");
if (fs.existsSync(agentsPath)) {
  const agents = fs.readFileSync(agentsPath, "utf8");
  const lineCount = agents.replace(/\s+$/u, "").split("\n").length;
  if (lineCount > 140) {
    failures.push(`AGENTS.md has ${lineCount} lines; maximum is 140`);
  }

  for (const relativePath of requiredFiles.filter((item) => item !== "AGENTS.md")) {
    if (!agents.includes(`\`${relativePath}\``)) {
      failures.push(`AGENTS.md does not map to canonical source: ${relativePath}`);
    }
  }

  if (/\b[0-9a-f]{40}\b/iu.test(agents)) {
    failures.push("AGENTS.md must not contain commit-specific SHA state");
  }
  if (/current[- ]head|current independent-review remediation/iu.test(agents)) {
    failures.push("AGENTS.md must not contain temporary PR remediation state");
  }
}

for (const relativePath of canonicalMetadataFiles) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) continue;
  const content = fs.readFileSync(fullPath, "utf8");
  for (const field of ["Status:", "Owner:", "Verification:"]) {
    if (!content.includes(field)) {
      failures.push(`${relativePath} is missing canonical metadata field ${field}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Repository knowledge verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Repository knowledge verification passed.");
