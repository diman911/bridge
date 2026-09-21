# 01 — Stabilize the bridge-core contract

**Status:** Done — 2026-09-22, see "Resolution notes" below.
**Depends on:** none (this is the base of the dependency chain)
**Related:** [00-bootstrap.md](00-bootstrap.md), [chrome-extension plan — "Protocol v1 scope"](../../../chrome-extension/docs/plans/integration-connector-gateway.md)

## Why

`packages/bridge-core/src/types.ts` and `connector.ts` are an explicit
first draft ("Exact shapes are expected to change as Phase 1 ... firms
up — this is a starting point for that work, not a stable contract yet").
Everything downstream — `bridge-worker`, all three connectors, and the
extension's vendored copy — depends on this shape being settled first.

## Current state (read before starting)

- `TargetReference` already covers `issue | test_case | test_run |
  incident | none`.
- `IntegrationAction` already includes `transition_issue` as distinct from
  `update_issue`, plus `add_comment`, `attach_evidence`, `write_test_result`,
  `share_only`.
- `Connector.capabilities` (`connector.ts`) already models
  `supportedTargets`/`supportedActions` as arrays, so a connector
  declaring a subset of the full enum already works structurally.
- **Missing:** no protocol version marker on `IntegrationCommand` or
  `ConnectorCapabilities`. No `ReadOperation` type for search/fetch — the
  source plan describes these in prose only
  ("The search and fetch operations are part of the provider-neutral read
  contract"); no such type exists in `src/`.
- **Missing:** `IntegrationResult` has only a single `issueUrl?: string` —
  no way to report per-attachment outcomes for the partial-success decision
  below.

## Task

- Add a `protocolVersion` field (or equivalent) to `IntegrationCommand` and
  `ConnectorCapabilities`. Define what "incompatible version" means for
  `bridge-worker` to reject cleanly and for the extension to tolerate
  additive capability fields it doesn't understand (source plan,
  "Extensibility constraints").
- Define `ReadOperation` (search issues / fetch issue) as a typed contract
  alongside `IntegrationCommand` — currently undrafted. Needs at minimum: a
  query shape for search (the generic issue picker's requirement — source
  plan, "Protocol v1 scope"), and a fetch-by-id shape. Decide whether these
  go through `Connector.execute()` or a separate method on `Connector`.
- Extend `IntegrationResult` with an attachment-level result list —
  decided 2026-09-21 (partial success): `attachments: Array<{ reference:
  EvidenceReference; ok: boolean; error?: IntegrationError }>`. `ok` on the
  overall result reflects the issue mutation only, not attachment outcomes.
- Keep `TargetReference`'s `test_case`/`test_run`/`incident` variants and
  `transition_issue` as already drafted — decided 2026-09-21 not to narrow
  these to `issue`-only for v1, so future test-case/close-bug use cases are
  additive. No connector needs to support them yet.
- Add validation (reject malformed commands with a typed error, not a
  thrown exception a caller has to guess the shape of) and conformance
  tests any connector implementation can run against.

## Acceptance criteria

- [x] `IntegrationCommand` and `ConnectorCapabilities` both carry a
      protocol version field.
- [x] `ReadOperation` (or equivalent) type exists and covers search + fetch.
- [x] `IntegrationResult` carries per-attachment results.
- [x] `bridge-core` has conformance tests a connector package can import
      and run against its own `execute()` implementation.
- [x] `docs/specs/bridge-core-contract.md` exists and is indexed in
      `docs/specs/README.md`.

## Resolution notes (2026-09-22)

- **`protocolVersion: number`** added to both `IntegrationCommand` and
  `ConnectorCapabilities` (`src/types.ts`, `connector.ts`).
  `PROTOCOL_VERSION = 1` and `isCompatibleProtocolVersion()` are the single
  source of truth for what "incompatible" means — `validateIntegrationCommand()`
  rejects a mismatched command with `error.code: 'unsupported_protocol_version'`.
- **`ReadOperation`/`ReadResult`** (`src/types.ts`) — `{ type: 'search',
  query, ... } | { type: 'fetch', id, ... }`, results carry a shared
  `IssueSummary` (`id`, `title`, `url`, `status?`). **Decided: a separate
  optional `Connector.read()` method, not folded into `execute()`** — a
  read has no target mutation, no idempotency concern, and a different
  result shape (list or single issue) than a write's single artifact
  reference; forcing it through `execute()`/`IntegrationResult` would mean
  overloading that type with fields meaningless to a write. `read()` is
  optional on the interface since a hypothetical write-only connector
  wouldn't need it, but every v1 connector (Jira/GitHub/Azure DevOps)
  implements it.
- **`AttachmentResult[]`** added to `IntegrationResult` as `attachments?:
  AttachmentResult[]`, exactly the shape task 01 specified.
- **Validation** (`src/validation.ts`, new): `validateIntegrationCommand()`
  checks protocol version, target kind, outcome, non-empty valid actions,
  and required string fields — returns a typed `{ error }` rather than
  throwing. Deliberately does **not** check whether the specific resolved
  connector supports the command's target/action — that's `bridge-worker`'s
  job against the connector's own `ConnectorCapabilities`, not a shape
  concern.
- **Conformance tests**: `runConnectorConformanceTests()`, exported from a
  separate `@fairlead/bridge-core/conformance` subpath (`package.json`
  `exports` map added), not the main `index.ts` barrel — keeps `vitest` out
  of the main entry point's import graph, since nothing in `bridge-worker`
  or a connector's runtime code should ever import it. Self-tested against
  a trivial fixture connector (`conformance.test.ts`) to prove the suite
  itself works before any real connector package depends on it.
- All of `types.ts`/`connector.ts`/`validation.ts`/`conformance.ts` build
  clean (`tsc`) and lint clean (`eslint`); `index.test.ts` updated for the
  new required fields plus new tests for the protocol-version rejection and
  partial-success-attachment cases; full suite (8 tests, 2 files) passes.
