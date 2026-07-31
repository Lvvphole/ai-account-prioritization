import {
  ATTENTION_QUEUE,
  EFFECTIVENESS,
  OPERATIONAL_HEALTH,
} from "../lib/admin-data";
import { MetricGrid, Section } from "../components/AdminBits";

export default function AdminOverviewPage() {
  return (
    <section>
      <div className="page-header">
        <h1>Overview</h1>
        <p className="muted">
          Production health, what the product is actually achieving, and everything
          waiting on a human.
        </p>
      </div>

      <Section
        title="Operational Health"
        sub="Is the pipeline running, and is the data underneath it trustworthy."
      >
        <MetricGrid items={OPERATIONAL_HEALTH} />
      </Section>

      <Section
        title="Product Effectiveness"
        sub="Whether reps act on the recommendations, and whether that moves revenue."
      >
        <MetricGrid items={EFFECTIVENESS} />
      </Section>

      <Section
        title="Attention Queue"
        sub="Work that will not clear itself. Each item links to where it is resolved."
      >
        <ul className="queue">
          {ATTENTION_QUEUE.map((item) => (
            <li key={item.label}>
              <a href={item.href}>
                <span className={`queue-count q-${item.tone}`}>{item.count}</span>
                <span className="queue-label">{item.label}</span>
                <span className="queue-go" aria-hidden="true">
                  →
                </span>
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </section>
  );
}
