# bridge-core contract

Current-state reference for `packages/bridge-core`'s wire contract. Design
rationale and decision history live in
[`../../../chrome-extension/docs/plans/integration-connector-gateway.md`](../../../chrome-extension/docs/plans/integration-connector-gateway.md)
("Generic integration contract", "Protocol v1 scope") — this file
describes the current shape, not why it looks this way.

## Protocol version

`PROTOCOL_VERSION` (`src/types.ts`) — currently `1`. Every
`IntegrationCommand` and `ConnectorCapabilities` carries a `protocolVersion`
field; `isCompatibleProtocolVersion()` is the single place that decides
whether a caller's version is executable. A command failing this check is
rejected by `validateIntegrationCommand()` with `error.code:
'unsupported_protocol_version'`, not thrown.

## Write path: `IntegrationCommand` → `IntegrationResult`

`Connector.execute(command, { signal })`. Every connector must pass the supplied abort signal to abortable provider requests. A timeout remains an unknown provider-side outcome: an aborted client request cannot prove that a provider mutation did not complete.
`IntegrationAction` in `src/types.ts` for the full enums — `TargetReference`
covers `issue | test_case | test_run | incident | none`; only `issue` has a
v1 connector implementation (see the source plan's "Extensibility reserved
now, not implemented"). `IntegrationAction` includes `transition_issue` as
distinct from `update_issue` for the same reason — reserved, not yet
implemented by any v1 connector.

`IntegrationResult.ok` reflects the target mutation only.
`IntegrationResult.attachments` (`AttachmentResult[]`) carries independent
`IntegrationError.httpStatus` is limited to retry-safe upstream statuses (`429`, `502`, `503`, `504`); `retryable: true` maps to `503` when no status is supplied. The Worker validates the status at runtime as well as through TypeScript.

per-file outcomes — a command can be `ok: true` with one or more failed
attachments (partial success, decided 2026-09-21 in the source plan).

## Read path: `ReadOperation` → `ReadResult`

`Connector.read(operation)`, optional on the `Connector` interface (a
write-only connector need not implement it; every v1 issue-tracker
connector does). `ReadOperation` is `{ type: 'search', query, ... } |
{ type: 'fetch', id, ... }`. `ReadResult.issues` (search) /
`ReadResult.issue` (fetch) use the shared `IssueSummary` shape
(`id`, `title`, `url`, `status?`).

## Validation

`validateIntegrationCommand()` (`src/validation.ts`) checks shape and
protocol-version compatibility only — it does not check whether the
_specific_ resolved connector supports the command's target/action; that's
a `ConnectorCapabilities` check the caller (`bridge-worker`) makes
separately against the connector it resolved.

## Conformance testing

`@fairlead/bridge-core/conformance`'s `runConnectorConformanceTests()`
is a vitest suite factory a connector package's own test file calls
against its `Connector` implementation. Checks contract-level shape
(protocol version, non-empty capabilities, a round-trip `execute()` call)
— not provider-specific correctness, which belongs in that connector's own
tests.

## What's not yet in this contract

- Idempotency-key retry-safety (dedup, replay rejection) — v1 has no
  exactly-once guarantee; see the source plan's "Future idempotency
  invariants" for the design a later protocol version would need.
- A `bridge-worker`/`bridge-runner` implementation — this package is the
  contract only, not an executable Bridge.
