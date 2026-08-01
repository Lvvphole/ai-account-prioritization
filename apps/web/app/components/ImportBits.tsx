import type { FindingSeverity, IngestionState, RecordDisposition } from "@repo/shared-schemas";
import {
  CHECK_LABEL,
  DISPOSITION_LABEL,
  STATE_LABEL,
  dispositionTone,
  stateTone,
  totalRows,
  type BatchFinding,
  type LineageHop,
  type ScanCheckRow,
} from "../lib/imports-data";

/** Shared pieces for the import console. Server components, no state. */

const TONE_CLASS: Record<string, string> = {
  good: "tag-good",
  warn: "tag-warn",
  bad: "tag-bad",
  neutral: "",
};

export function IngestionStatePill({ state }: { state: IngestionState }) {
  return (
    <span className={`badge ${TONE_CLASS[stateTone(state)] ?? ""}`}>{STATE_LABEL[state]}</span>
  );
}

export function DispositionPill({ disposition }: { disposition: RecordDisposition }) {
  return (
    <span className={`badge ${TONE_CLASS[dispositionTone(disposition)] ?? ""}`}>
      {DISPOSITION_LABEL[disposition]}
    </span>
  );
}

const SEVERITY_TONE: Record<FindingSeverity, string> = {
  info: "",
  warning: "tag-warn",
  high: "tag-bad",
  critical: "tag-bad",
};

export function SeverityPill({ severity }: { severity: FindingSeverity }) {
  return <span className={`badge ${SEVERITY_TONE[severity]}`}>{severity}</span>;
}

/**
 * The scan checklist (section 7.2 step 5).
 *
 * A check that did not run is rendered as its own state, not as a pass. The
 * malware row in particular distinguishes `unavailable` from `clean`, because
 * production treats a scanner it could not reach as a refusal and the screen
 * has to agree with the pipeline about that.
 */
export function ScanChecklist({
  checks,
  malwareStatus,
  providerId,
}: {
  checks: ScanCheckRow[];
  malwareStatus: "clean" | "infected" | "unavailable";
  providerId: string | null;
}) {
  return (
    <ul className="scan-list">
      {checks.map((c) => {
        const isMalware = c.check === "malware";
        const state = isMalware
          ? malwareStatus === "clean"
            ? "pass"
            : malwareStatus === "infected"
              ? "fail"
              : "unknown"
          : c.passed
            ? "pass"
            : "fail";
        const label =
          state === "pass"
            ? "Passed"
            : state === "fail"
              ? isMalware
                ? "Infected"
                : "Failed"
              : "Unavailable";
        return (
          <li key={c.check} className={`scan-row scan-${state}`}>
            <span className="scan-mark" aria-hidden="true">
              {state === "pass" ? "✓" : state === "fail" ? "✕" : "?"}
            </span>
            <span className="scan-name">{CHECK_LABEL[c.check]}</span>
            <span className="scan-state">{label}</span>
            <span className="scan-detail muted">
              {isMalware && state === "unknown"
                ? "No approved scanning provider answered. In production this stops the batch; it is not treated as clean."
                : (c.detail ??
                  (isMalware && providerId ? `Scanned by ${providerId}` : ""))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Row dispositions with the committable boundary drawn explicitly. */
export function DispositionBar({
  dispositions,
}: {
  dispositions: Record<RecordDisposition, number>;
}) {
  const total = totalRows(dispositions);
  const order: RecordDisposition[] = ["ready", "warning", "duplicate", "quarantined", "rejected"];
  return (
    <div className="disp">
      <div className="disp-bar" role="img" aria-label={`${total} rows by disposition`}>
        {order.map((d) =>
          dispositions[d] > 0 ? (
            <span
              key={d}
              className={`disp-seg disp-${d}`}
              style={{ width: `${(dispositions[d] / Math.max(total, 1)) * 100}%` }}
              title={`${DISPOSITION_LABEL[d]}: ${dispositions[d].toLocaleString("en-US")}`}
            />
          ) : null,
        )}
      </div>
      <ul className="disp-key">
        {order.map((d) => (
          <li key={d}>
            <span className={`disp-dot disp-${d}`} aria-hidden="true" />
            <span className="disp-label">{DISPOSITION_LABEL[d]}</span>
            <span className="disp-count">{dispositions[d].toLocaleString("en-US")}</span>
          </li>
        ))}
      </ul>
      <p className="note">
        {DISPOSITION_LABEL.quarantined} and {DISPOSITION_LABEL.rejected} rows cannot commit. They
        stay staged with their findings so the file does not have to be re-uploaded to see why.
      </p>
    </div>
  );
}

export function FindingsTable({ findings }: { findings: BatchFinding[] }) {
  if (findings.length === 0) {
    return <p className="muted">No findings. Every row passed all five validation layers.</p>;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Severity</th>
            <th scope="col">Rule</th>
            <th scope="col">Field</th>
            <th scope="col">Rows</th>
            <th scope="col">What it means</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => (
            <tr key={f.ruleId}>
              <td>
                <SeverityPill severity={f.severity} />
              </td>
              <td>
                <code>{f.ruleId}</code>
              </td>
              <td>{f.canonicalField ?? "—"}</td>
              <td className="num">{f.rowsAffected.toLocaleString("en-US")}</td>
              <td>
                {f.explanation}
                {f.downstreamImpact ? (
                  <span className="muted"> {f.downstreamImpact}</span>
                ) : null}
                {f.redactedValue ? (
                  <span className="muted"> Example value: <code>{f.redactedValue}</code></span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Lineage({ hops }: { hops: LineageHop[] }) {
  return (
    <ol className="lineage">
      {hops.map((hop, i) => (
        <li key={hop.ref}>
          <span className="lineage-step">{i + 1}</span>
          <div>
            <div className="lineage-layer">{hop.layer}</div>
            <div className="lineage-ref">{hop.ref}</div>
            <div className="muted lineage-detail">{hop.detail}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function SampleNotice({ what }: { what: string }) {
  return (
    <p className="note">
      <span className="badge">Sample</span> {what} is illustrative data. This deploy has no
      ingestion worker or storage bucket attached, so nothing here was produced by a real upload.
    </p>
  );
}
