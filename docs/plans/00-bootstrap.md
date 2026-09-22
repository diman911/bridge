# Bootstrap: first stage of the integration connector bridge

**Status:** draft

Concrete first steps for _this_ repo. Full design (transports,
responsibility boundaries, all delivery phases, open questions) is
[`../../../chrome-extension/docs/plans/integration-connector-gateway.md`](../../../chrome-extension/docs/plans/integration-connector-gateway.md)
("Phase 1 — first stage: contract + cloud-mode Bridge") — read that first.
This file makes that phase actionable in this repo and tracks the one
decision that gates everything else.

**Scope note (2026-09-21):** the source plan's Phase 1 (contract only,
`direct` preserved) and Phase 2 (`bridge-worker` execution) merged into one
delivery — see that plan's "Decision" section for why. This repo's actual
work is broken into the numbered task files below:
[01](01-stabilize-contract.md) (contract), [02](02-bridge-worker.md)
(`bridge-worker`), [03](03-connector-jira.md) and
[05](05-connector-azure-devops.md) (the remaining numbered connector plans;
GitHub connector behavior is specified in
[`../specs/bridge-core-contract.md`](../specs/bridge-core-contract.md)), and
[06](06-retire-extension-direct-transport.md) (cross-repo: extension
cutover off `direct`). This file stays the overview and the home of the
vendoring decision below, which doesn't change with the merge.

## Decided: extension compatibility and contract distribution

Phase 1 requires `../chrome-extension` to refactor its built-in Jira/GitHub
paths onto the shared action contract defined here. That means the contract
types in `packages/bridge-core` need to reach a _different repository_.
Options:

| Option                                                                                                                                                               | Trade-off                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Publish `@fairlead/bridge-core` to a registry** (private npm registry or GitHub Packages), consumed as a normal `devDependency`/`dependency` in `chrome-extension` | Versioned, no drift once adopted; requires org registry infra to exist — unconfirmed, check with whoever owns `../control-plane`'s deploy tooling         |
| **Vendor a copy** of the types into `chrome-extension`                                                                                                               | Zero infra, but two copies drift — explicitly the failure mode `docs/processes/ai-workflow.md` warns against for specs; same risk applies to shared types |
| **Codegen from a schema** (e.g. JSON Schema/OpenAPI as source of truth, generate both sides)                                                                         | Most robust long-term, most setup cost; premature before the shape in `packages/bridge-core/src/types.ts` has stabilized                                  |

**Decided: vendoring.** Copy the contract types from `packages/bridge-core`
into `chrome-extension` directly — no registry, no codegen. `bridge-core` is
the source of truth: the contract changes on this repo's side first, and
`chrome-extension` is always the catching-up side, never the other way
around. Because the extension ships through Chrome Web Store review (slower,
less predictable rollout than this repo's own deploys), the contract needs an
explicit compatibility rule rather than assuming both sides update in lockstep
— concretely, a version marker on the capability manifest/command payload so
Bridge can tell which contract version a given extension build is speaking
and either translate for it or reject cleanly, instead of assuming the latest
shape. Revisit registry-publish or codegen later if manual vendoring/sync
becomes the bottleneck once the contract shape has stabilized.

The wire contract is versioned JSON. A version marker appears on commands and
capability manifests. Bridge rejects an incompatible version clearly, while an
extension tolerates additive capability fields it does not know. New
connectors ship in the unified Bridge release and are added to the Control
Plane catalog; the extension must not need provider-specific code for a
connector that stays within the standard protocol fields.

## Protocol v1 decisions

- Supported providers: Jira Cloud, GitHub Issues, and **Azure DevOps
  Services** (added 2026-09-21; Azure DevOps Server/on-prem is out of scope
  — would need `private`-mode Bridge, not yet built).
- Operations: create issue, update issue, search issues, and fetch issue.
- Standard write fields: `title` and `description`. Connector-specific form
  fields are out of scope for v1. Azure DevOps is the one connector needing
  more than these to satisfy the provider's own validation — decided
  2026-09-21: `connector-azure-devops` fixes `System.WorkItemType` to `Bug`
  and omits `System.AreaPath`/`System.IterationPath`, relying on the target
  project's own process-template defaults rather than a new CP config
  surface. A project with no default on a required field sees a validation
  error surfaced from Azure DevOps itself.
- Credentials: per-user OAuth or a pasted PAT for all three connectors —
  Azure DevOps supports both from v1 (decided 2026-09-21), not PAT-only.
- Create/update are synchronous, one provider mutation per operation. The
  result reports the provider response outcome and issue reference.
- v1 has no exactly-once guarantee after an uncertain network failure. Keep
  an idempotency field only if it is useful for observability/future evolution;
  do not claim retry-safe deduplication.
- HAR files and screenshots are native tracker attachments. Commands carry
  short-lived references to separately stored, sanitized Data Plane evidence,
  never binary attachment data or a full recording.
- **Attachment failure after a successful issue mutation — decided
  2026-09-21: partial success.** The command reports `ok: true` with the
  issue reference, plus a per-file attachment result list
  (`IntegrationResult.attachments`, not yet in `src/types.ts`). See
  [01-stabilize-contract.md](01-stabilize-contract.md).
- **Extensibility reserved now.** `TargetReference` already covers
  `test_case`/`test_run`/`incident`/`none` and `IntegrationAction` already
  has `transition_issue` distinct from `update_issue` in the current draft
  (`src/types.ts`) — decided 2026-09-21 to keep these as-is rather than
  narrow to `issue`-only, so a future test-case or close-bug use case is an
  additive capability, not a protocol version bump. No v1 connector
  declares support for them.
- Control Plane owns tracker-instance configuration and Bridge routing. The
  extension receives only the resolved Bridge address and capabilities; Bridge
  resolves the tracker endpoint/configuration and the caller's personal
  OAuth/PAT credential from Control Plane per command.

## Task list (this repo)

Superseded by the numbered task files, in dependency order:

1. **[01-stabilize-contract.md](01-stabilize-contract.md)** — finish
   `packages/bridge-core`: protocol version marker, `ReadOperation` type,
   attachment-result field, validation, conformance tests.
2. **[02-bridge-worker.md](02-bridge-worker.md)** — Cloudflare Worker
   adapter (`bridge-worker`), cloud-mode execution, CP integration
   (credential/config resolution, identity-token verification).
3. **[03-connector-jira.md](03-connector-jira.md)** and
   **[05-connector-azure-devops.md](05-connector-azure-devops.md)** — the
   remaining numbered connector plans, can proceed in parallel once 01/02
   land. GitHub connector behavior and capabilities are documented in the
   bridge-core contract spec.
4. **[06-retire-extension-direct-transport.md](06-retire-extension-direct-transport.md)**
   — cross-repo: vendor the contract into `../chrome-extension`, refactor
   its Jira/GitHub paths onto `Connector`, switch both from `direct` to
   Bridge, and cut `direct` — the actual code change lives in
   `chrome-extension`, tracked here because it's gated on 01-05.

## Non-goals for this phase

- No `bridge-runner` (private-mode Bridge) implementation — still Phase 3
  of the source plan, unaffected by the Phase 1/2 merge.
- No Log Source connector work (separate concern in the source plan).
- No policy-driven field templates / verdict-status mapping UI — Azure
  DevOps required fields rely on process-template defaults instead (see
  "Protocol v1 decisions" above).

## Open questions carried forward

None specific to this repo remain — attachment partial-success and
protocol extensibility were decided 2026-09-21 (see "Protocol v1
decisions" above). The source plan's "Open questions" section carries the
one remaining cross-cutting item (Bridge endpoint-change handling
mid-session), owned by `control-plane`/`chrome-extension`, not this repo.
