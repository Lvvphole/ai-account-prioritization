import { MOCK_SCORING_CONFIG } from "../../lib/mock-data";
import { requireCapability } from "../../lib/auth";

export default async function AdminScoringPage() {
  await requireCapability("edit_scoring_config");

  const cfg = MOCK_SCORING_CONFIG;
  const weights = Object.entries(cfg.weights);

  return (
    <section>
      <h1>Admin · Scoring Configuration</h1>
      <p className="muted">
        These deterministic weights and thresholds — not the LLM — decide account
        rank. Changing them is a config change, fully auditable.
      </p>

      <div className="card">
        <h3>Feature weights</h3>
        <table>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Weight</th>
            </tr>
          </thead>
          <tbody>
            {weights.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Thresholds</h3>
        <table>
          <tbody>
            <tr>
              <td>Max recommendations / run</td>
              <td>{cfg.maxRecommendations}</td>
            </tr>
            <tr>
              <td>Pipeline saturation (USD)</td>
              <td>{cfg.pipelineSaturationUsd.toLocaleString("en-US")}</td>
            </tr>
            <tr>
              <td>High-pipeline threshold (USD)</td>
              <td>{cfg.highPipelineThresholdUsd.toLocaleString("en-US")}</td>
            </tr>
            <tr>
              <td>Stale-contact threshold (days)</td>
              <td>{cfg.staleContactThresholdDays}</td>
            </tr>
            <tr>
              <td>Churn-risk health threshold</td>
              <td>{cfg.churnRiskHealthThreshold}</td>
            </tr>
            <tr>
              <td>Min publishable confidence</td>
              <td>{cfg.minPublishableConfidence}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
