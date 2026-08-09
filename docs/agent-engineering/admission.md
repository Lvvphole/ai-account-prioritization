# ADR-002 Control Admission — Agent Engineering Standard

**Decision owner:** repository maintainers  
**Disposition:** APPROVED FOR IMPLEMENTATION by explicit user instruction, subject
to Artifact DoD and normal merge authority.

## Evidence

The current root `AGENTS.md` is a monolithic always-loaded operating contract of
38,702 bytes. The requested engineering standard must be reusable across coding
agents while avoiding context drift and unnecessary token use.

The reviewed harness-engineering evidence reports that a giant `AGENTS.md`
crowded out task/code context, became stale, and was difficult to verify. Its
replacement pattern was a short map, structured repository-local documentation,
progressive disclosure, deterministic checks, and remediation-bearing tooling.

## Insufficiency

The current `.harness` is a deterministic post-change verifier/gate router. It has
no repository-native mechanism for selectively loading reusable engineering
ground truths before a coding agent plans or edits. The current `AGENTS.md` also
loads far more operational detail than every task needs.

## Minimum mechanism

Add only:

1. repository-local canonical rules under `docs/agent-engineering/`;
2. one repo-local Codex/agent skill for progressive disclosure;
3. one dependency-free Node renderer/validator;
4. one focused test file;
5. one declarative contract entry in the existing `.harness/contract.yaml`;
6. four root package scripts.

Do not add an LLM classifier, path resolver, vector/RAG index, new state machine,
new verdict vocabulary, new verifier, new telemetry system, or agent
orchestration.

## Acceptance evidence

The focused tests must prove:

- exactly 33 engineering rules and 8 rejected-design meta-rules;
- `general` equals the exact five-rule kernel;
- invalid explicit profiles fail instead of degrading;
- Python/TypeScript overlays are explicit;
- ordinary profiles never load rejected-design rules;
- no repository-specific product facts are copied into the reusable registry;
- `applies_to.paths` is accepted but ignored by v1;
- `on_failure + semantic-review` is rejected;
- rendered context excludes sources/rationales;
- the skill never instructs the agent to infer a profile;
- the standard cannot emit verifier verdicts;
- the new contract runs through the existing harness kernel.

## Added burden

- No production runtime dependency.
- No new NPM dependency or lockfile change.
- No durable state.
- No network dependency.
- One small deterministic renderer plus tests.
- A repository skill and structured documentation.
- One additional focused gate only when the engineering-standard surface changes.

## Net value

The mechanism directly addresses the explicit requirement for reusable,
progressively disclosed engineering guidance while preserving the existing
deterministic verifier and authority model. It is smaller than a new context
service, RAG layer, classifier, or control plane.

No claim of measured token, latency, or quality improvement is made until
post-change measurement is available under the repository's authoritative
Harness Fitness prerequisites.
