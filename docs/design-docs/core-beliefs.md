# Core Beliefs

Status: canonical
Owner: architecture
Verification: architecture review

These beliefs guide design choices. They are stable. Do not add temporary PR findings here.

1. **Deterministic authority first.** Use deterministic code for decisions that can be represented as explicit policy.
2. **Model output is candidate content.** A model can improve language and synthesis without owning business authority.
3. **Fail closed with evidence.** A failed authority gate produces a held or blocked result with durable evidence.
4. **Contain failures locally.** Bad evidence for one account must not stop unrelated account work.
5. **One authority per concern.** Business state, event publication, workflow progression, and domain decisions have separate owners.
6. **One retry owner per operation.** Do not create overlapping retry loops.
7. **Repository knowledge is the system of record.** Agents must be able to discover authoritative requirements from versioned repository artifacts.
8. **Context is scarce.** `AGENTS.md` is a map. Load detailed guidance only when the task needs it.
9. **Design before repeated repair.** A repeated defect class means the mechanism or invariant needs redesign. Do not continue line-by-line patching.
10. **Tests prove deterministic rules.** Use executable tests for machine-checkable behavior. Use LLM judges only for subjective quality.
11. **Trace authority to source evidence.** Derived facts, reasons, approvals, and side effects require replayable provenance.
12. **Prefer the smallest sufficient harness.** Added complexity must earn its latency, cost, maintenance, and failure surface.
13. **Frameworks are adapters, not architecture.** Domain policy remains portable across workflow and model providers.
14. **Human approval stays real.** A resume signal, model assertion, or synthetic flag cannot substitute for current persisted approval.
15. **Observability is evidence, not authority.** Metrics and traces explain behavior. They do not decide business outcomes.
