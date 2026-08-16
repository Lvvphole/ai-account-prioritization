# ADR-003: Multi-Provider Capability with Single-Active Runtime

- Status: Accepted
- Date: 2026-08-16
- Decision owner: Repository maintainer
- Scope: P4 runtime provider capability, qualification, production admission, sandbox isolation, provider switching, and OpenAI Agents SDK introduction
- Related authority: `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/P4_UNIT_3_ADMISSION_ACCEPTANCE_B.md`, ADR-001, ADR-002

## Context

The current P4 runtime has a provider-neutral `RuntimeModelClient`, but only the
Anthropic production adapter and Anthropic Vercel Sandbox profile are implemented.
Offline qualification already supports more than one provider family.

The next increment will add OpenAI support and can introduce the OpenAI Agents SDK.
Deleting the Anthropic adapter would reduce provider diversity without being
required for the OpenAI integration. Automatic provider failover would preserve
more model availability, but it would add runtime routing, retry, health, budget,
and result-selection behavior that current P4 does not require.

ADR-002 requires the smallest sufficient mechanism that preserves mandatory
invariants. The required provider architecture must also keep the deterministic
authority envelope, sandbox boundary, audit identity, qualification evidence, and
failure behavior externally verifiable.

## Decision

The repository is **multi-provider capable and single-active in production**.

The repository may contain more than one implemented provider adapter. It may
qualify configurations from more than one provider. Qualification does not grant
runtime authority.

A running production deployment uses exactly one production model configuration.
The active provider, model, reasoning profile, budgets, and fallback policy must
match the immutable production admission artifact loaded by that deployment.
Provider-specific output configuration and sandbox execution profile are resolved
deterministically from the active provider through the production registry. They
must be recorded in runtime audit evidence and must not be selected by model
output or customer-controlled data.

Multiple immutable qualification reports and staged admission artifacts can exist
as audit history or successor candidates. They do not create active-active
execution. A staged successor becomes active only through a controlled deployment
that drains or stops existing workers and starts the runtime with the successor
admission artifact.

Automatic cross-provider failover is not authorized in current P4. A runtime
provider failure can use only the admitted deterministic template fallback or
hold behavior. The runtime must not invoke another provider because of timeout,
error, latency, cost, health, availability, model output, or retry exhaustion.

Provider switching is a control-plane operation. It is not a per-request routing
decision.

## Provider lifecycle

Use these terms consistently:

```text
SUPPORTED
  provider identity is valid at the common runtime boundary

IMPLEMENTED
  production adapter and required provider-specific runtime controls exist

QUALIFIED
  the configured qualification boundary passes for one provider/model/configuration

STAGED
  an immutable production admission artifact exists but is not loaded by workers

ACTIVE
  the running deployment references exactly one admission artifact
```

More than one provider can be `IMPLEMENTED` or `QUALIFIED`. More than one
immutable admission artifact can exist as history or a staged successor. Exactly
one production configuration can be `ACTIVE` for a running deployment.

`IMPLEMENTED` and `QUALIFIED` do not imply `ACTIVE`.

## Sandbox isolation

Each production-capable provider requires a fixed, provider-specific admitted
sandbox execution profile.

Each profile must define the exact provider host, path, method, credential
transformation, and other required network restrictions. Runtime model output,
customer-controlled data, and model-generated data must not select an arbitrary
provider endpoint or credential target.

Each provider profile must preserve these current sandbox invariants:

- the sandbox is ephemeral and non-persistent;
- it receives no host environment and exposes no ports;
- provider egress is limited to the fixed admitted endpoint and method;
- the real provider credential is absent from sandbox files and command environment;
- the sandbox receives only the provider-specific placeholder credential;
- the trusted network-policy boundary injects the real credential at egress;
- the production registry has no direct-host provider fallback;
- creation, execution, response transfer, and cleanup stay within the runtime deadline; and
- sandbox failure enters only the deterministic template fallback or hold path.

The current implemented profile remains
`vercel-sandbox-anthropic-egress-v1` until another provider profile is implemented
and verified. This decision does not claim that an OpenAI production sandbox
profile already exists.

## OpenAI Agents SDK authorization

The OpenAI Agents SDK is authorized as an implementation dependency for the
OpenAI provider path when it remains behind the repository's existing authority
boundaries.

For current P4, SDK use is limited to bounded drafting and synthesis that
implements the existing runtime model contract. Introducing the SDK does not
transfer provider selection, task authority, verification, publication, or
completion authority to the SDK.

The SDK must use the exact provider, model, and effective configuration selected
by the loaded production admission and provider registry. SDK defaults cannot
silently change that identity. SDK execution must remain inside the existing
externally enforced call, token, time, retry, and attempt budgets. An SDK agent
loop must not create unbounded or unrecorded model calls. SDK guardrails,
termination, or completion signals do not replace the repository's deterministic
schema, grounding, permission, approval, publication, or completion gates.

The repository's PII-safe observability path remains canonical. SDK tracing or
another external telemetry path requires a separate data-boundary decision before
production enablement.

This decision does not authorize these deferred capabilities in current P4:

- model-controlled candidate-action selection;
- general tool orchestration or side-effecting model tools;
- SDK handoffs or subagent delegation;
- runtime provider routing;
- automatic cross-provider failover;
- multi-model voting;
- production caching infrastructure; or
- any new protected side-effect authority.

A later increment can implement an approved target capability only after the
required explicit implementation ruling and ADR-002 admission evidence.

## Alternatives considered

### Remove Anthropic and make OpenAI the only implemented provider

This is the smallest provider code surface. It also removes a working provider
adapter and reduces portability without being necessary for the OpenAI change.
It is not selected.

### Keep multiple providers implemented and activate one configuration

This preserves provider portability while keeping the production data path
simple. Provider switching remains deliberate and auditable. This is selected.

### Automatic active-passive provider failover

This can increase model-backed availability during a provider outage. It also
requires runtime failure classification, cross-provider budget policy, health or
retry state, result ownership rules, and more complex audit behavior. The current
deterministic fallback already contains provider failure. This is deferred.

### Active-active provider routing or voting

This can optimize requests for latency, cost, or model quality. It adds the
largest runtime control plane and weakens the single-configuration execution
model. Current P4 explicitly defers routing and voting. This is not selected.

## Quality attributes and trade-offs

The selected design improves provider portability and recovery options without
adding request-time routing. It keeps runtime behavior easier to audit and keeps
provider failure contained by the existing deterministic fallback or hold path.

The design adds maintenance cost because each implemented provider needs its own
adapter, sandbox profile, credential handling, tests, and qualification evidence.
That cost is accepted because the provider implementations remain isolated behind
the existing common boundary.

The design does not provide automatic model continuity during a provider outage.
Model-backed drafting can degrade to the deterministic template or hold until a
controlled provider switch occurs. This is accepted for current P4 because the
deterministic fallback is an existing mandatory fail-safe.

## Consequences

`RuntimeModelClient` remains the common provider-neutral application boundary.
Sales-execution scoring, ranking, next-best-action selection, grounding,
permissions, approval, publication, and completion authority remain unchanged.

The provider registry can later contain Anthropic and OpenAI as implemented
providers. The active runtime still resolves only the provider named by the
loaded production admission artifact.

The Anthropic runtime adapter and sandbox profile remain in the repository when
OpenAI becomes active, unless a later explicit decision removes them.

The OpenAI implementation must receive its own fixed sandbox profile and
verification before it can become production-admittable.

Qualification policy can evaluate candidates from multiple providers. Candidate
priority remains deterministic. Production activation still selects one exact
qualified and production-admittable configuration.

## Acceptance evidence

Implementation increments that rely on this decision must prove the applicable
properties with repository verification:

1. More than one implemented provider does not create runtime routing.
2. A running deployment loads exactly one production admission artifact.
3. Admission-owned runtime fields exactly match the active admission artifact.
4. Provider-specific output configuration and sandbox profile resolve only from the active provider through the trusted registry.
5. Provider failure cannot invoke a different provider automatically.
6. Each production provider uses only its admitted fixed sandbox profile.
7. Direct-host provider fallback remains unavailable in production.
8. Provider or SDK output cannot change protected deterministic authority fields.
9. Acceptance A remains valid with model drafting disabled.
10. Acceptance B passes for the active qualified production configuration.
11. All applicable repository completion gates pass.

This ADR authorizes the architecture and the bounded OpenAI provider integration.
It does not itself prove implementation completion or production admission.
