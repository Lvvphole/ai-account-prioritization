import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  prepareQualificationOutputPaths,
  writeProductionAdmissionOutput,
  writeQualificationReportOutput,
} from "./admission-output-lifecycle";

describe("P4 qualification output preflight", () => {
  it("rejects an admission path beneath a regular file before qualification", () => {
    const dir = mkdtempSync(join(tmpdir(), "p4-output-parent-"));
    const blocker = join(dir, "not-a-directory");
    const reportPath = join(dir, "report.json");
    const admissionPath = join(blocker, "admission.json");
    writeFileSync(blocker, "blocker\n", "utf8");

    try {
      expect(() => prepareQualificationOutputPaths(reportPath, admissionPath)).toThrow();
      expect(existsSync(reportPath)).toBe(false);
      expect(readFileSync(blocker, "utf8")).toBe("blocker\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("validates creatable parents without consuming immutable output paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "p4-output-parent-"));
    const reportPath = join(dir, "reports", "report.json");
    const admissionPath = join(dir, "admissions", "admission.json");

    try {
      expect(() => prepareQualificationOutputPaths(reportPath, admissionPath)).not.toThrow();
      expect(existsSync(reportPath)).toBe(false);
      expect(existsSync(admissionPath)).toBe(false);

      writeQualificationReportOutput(reportPath, "report\n");
      writeProductionAdmissionOutput(admissionPath, "admission\n");
      expect(readFileSync(reportPath, "utf8")).toBe("report\n");
      expect(readFileSync(admissionPath, "utf8")).toBe("admission\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
