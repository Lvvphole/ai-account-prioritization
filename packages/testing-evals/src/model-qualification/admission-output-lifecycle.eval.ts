import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  prepareQualificationOutputPaths,
  releaseQualificationOutputPaths,
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

  it("reserves creatable destinations without consuming immutable output paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "p4-output-parent-"));
    const reportPath = join(dir, "reports", "report.json");
    const admissionPath = join(dir, "admissions", "admission.json");

    try {
      const reservation = prepareQualificationOutputPaths(reportPath, admissionPath);
      expect(existsSync(reportPath)).toBe(false);
      expect(existsSync(admissionPath)).toBe(false);

      writeQualificationReportOutput(reportPath, "report\n");
      writeProductionAdmissionOutput(admissionPath, "admission\n");
      expect(readFileSync(reportPath, "utf8")).toBe("report\n");
      expect(readFileSync(admissionPath, "utf8")).toBe("admission\n");
      releaseQualificationOutputPaths(reservation);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a concurrent epoch that targets a reserved destination before spend", () => {
    const dir = mkdtempSync(join(tmpdir(), "p4-output-race-"));
    const firstReportPath = join(dir, "report-first.json");
    const secondReportPath = join(dir, "report-second.json");
    const admissionPath = join(dir, "admission.json");

    const firstReservation = prepareQualificationOutputPaths(firstReportPath, admissionPath);
    try {
      expect(() => prepareQualificationOutputPaths(secondReportPath, admissionPath)).toThrow(
        "reserved by another qualification process",
      );
      expect(existsSync(firstReportPath)).toBe(false);
      expect(existsSync(secondReportPath)).toBe(false);
      expect(existsSync(admissionPath)).toBe(false);
    } finally {
      releaseQualificationOutputPaths(firstReservation);
    }

    try {
      const secondReservation = prepareQualificationOutputPaths(secondReportPath, admissionPath);
      releaseQualificationOutputPaths(secondReservation);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
