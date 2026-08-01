import { IMPORT_TEMPLATES, IMPORT_TEMPLATE_KINDS } from "@repo/shared-schemas";
import type { ImportTemplateKind } from "@repo/shared-schemas";
import { requireCapability } from "../../../../lib/auth";
import { IMPORT_LIMITS } from "../../../../lib/imports-data";
import { Section } from "../../../../components/AdminBits";
import DataSubnav from "../../../../components/DataSubnav";
import UploadPanel from "./UploadPanel";

export const metadata = { title: "New import" };

function isTemplateKind(value: string | undefined): value is ImportTemplateKind {
  return value !== undefined && (IMPORT_TEMPLATE_KINDS as readonly string[]).includes(value);
}

/**
 * Steps 1 to 3 of the import workflow: choose a type, take the template, pick a
 * file (section 7.2).
 *
 * The type choice is a link rather than client state so the chosen template is
 * in the URL. An administrator who is halfway through and needs a colleague to
 * look can paste the address.
 */
export default async function NewImportPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  await requireCapability("create_manual_import");
  const params = await searchParams;
  const kind: ImportTemplateKind = isTemplateKind(params.kind) ? params.kind : "accounts";
  const template = IMPORT_TEMPLATES[kind];

  return (
    <section>
      <div className="page-header">
        <h1>New import</h1>
        <p className="muted">
          Three steps before anything is uploaded: pick what you are importing, take the template
          for it, then choose your file. The checks below run in your browser so you find out
          about a bad file now rather than after a 10 MB upload.
        </p>
      </div>

      <DataSubnav />

      <Section title="1. Choose what you are importing" sub="One canonical object type per file, or the combined template.">
        <div className="kind-grid">
          {IMPORT_TEMPLATE_KINDS.map((k) => (
            <a
              key={k}
              href={`/admin/data/imports/new?kind=${k}`}
              className={`kind-card${k === kind ? " active" : ""}`}
              aria-current={k === kind ? "true" : undefined}
            >
              <span className="kind-label">{IMPORT_TEMPLATES[k].label}</span>
              <span className="muted small">
                {IMPORT_TEMPLATES[k].columns.length} columns ·{" "}
                {IMPORT_TEMPLATES[k].columns.filter((c) => c.required).length} required
              </span>
            </a>
          ))}
        </div>
      </Section>

      <Section
        title={`2. Download the ${template.label.toLowerCase()} template`}
        sub={`Version ${template.version}. The template is the contract: what it marks required is what validation will demand.`}
        action={
          <a className="action-btn btn-primary" href={`/api/admin/data/imports/template?kind=${kind}`}>
            Download template
          </a>
        }
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Column</th>
                <th scope="col">Required</th>
                <th scope="col">Format</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {template.columns.map((c) => (
                <tr key={c.canonicalField}>
                  <td>
                    <code>{c.canonicalField}</code>
                  </td>
                  <td>
                    {c.required ? (
                      <span className="badge tag-warn">Required</span>
                    ) : (
                      <span className="muted">Optional</span>
                    )}
                  </td>
                  <td className="muted small">
                    {c.enumValues
                      ? c.enumValues.join(" · ")
                      : c.transform.replace(/_/g, " ")}
                    {c.maxLength ? (
                      <div>max {c.maxLength.toLocaleString("en-US")} chars</div>
                    ) : null}
                  </td>
                  <td>{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          A column that is not in this template is dropped rather than guessed at. If your export
          has extra fields, they are recorded as ignored and never silently mapped onto something
          that looks similar.
        </p>
      </Section>

      <UploadPanel kind={kind} limits={IMPORT_LIMITS} />
    </section>
  );
}
