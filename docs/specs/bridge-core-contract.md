# bridge-core contract

Current-state reference for `packages/bridge-core`'s wire contract. Design
rationale and decision history live in
[`../../../chrome-extension/docs/plans/integration-connector-gateway.md`](../../../chrome-extension/docs/plans/integration-connector-gateway.md)
("Generic integration contract", "Protocol v1 scope") — this file
describes the current shape, not why it looks this way.

## Protocol version

The public write wire format is `EnvelopeV1` in `src/envelope-v1.ts`. It
contains `protocolVersion`, `project_id`, `tracker_instance_id`, `intent`,
`title`, `description`, `report`, `options`, and `idempotencyKey`; it never
contains a caller identity, connector identity, or connector configuration.
`decodeEnvelope()` selects a registered version decoder and maps the wire
envelope to `InternalIntegrationCommand` (camel-cased trusted routing fields).
`SUPPORTED_PROTOCOL_VERSIONS` is the single compatible-version set used by
`isCompatibleProtocolVersion()`. A version not in that set returns
`error.code: 'unsupported_protocol_version'`, not an exception.

`MAX_ENVELOPE_BYTES`, `MAX_TITLE_LENGTH`, and `MAX_DESCRIPTION_LENGTH` are
enforced while decoding. `DeprecationNotice` may be included in
`IntegrationResult.metadata` when a supported version is approaching its
published end of support.

Frozen wire examples live in `packages/bridge-core/contract/v1/`. The decoder
test replays every request fixture in every stored version directory.

## Write path: `ConnectorCommand` → `IntegrationResult`

`Connector.execute(command, { signal })` takes a `ConnectorCommand`
(`src/report-mapping.ts`), which `mapReportToIssue()` derives from the decoded
envelope: `intent`, `title`, the user-authored `description`,
`technicalContext` (URL, recording window, counts), `artifacts` (the HAR and
screenshot files selected by `options`), and `idempotencyKey`. It carries no
caller, connector id or report body; Bridge resolves those from the Control
Plane record and the verified token. `ConnectorCapabilities.supportedActions`
is a subset of `EnvelopeIntent['action']` (`create_issue`, `update_issue`,
`add_comment`); the Worker answers an undeclared action with
`unsupported_action` (422) and connectors do the same when called directly.
Only `issue` targets have a v1 connector implementation.

Every connector must pass the supplied abort signal to abortable provider
requests. A timeout remains an unknown provider-side outcome: an aborted
client request cannot prove that a provider mutation did not complete.

### Description rendering and update merge

`src/description.ts` owns the provider formatters, so the marker logic is not
repeated per connector: `mergeAdf` (Jira), `mergeMarkdown` (GitHub) and
`mergeHtml` (Azure DevOps). The Fairlead technical block is delimited by
`<!-- fairlead:begin -->` / `<!-- fairlead:end -->` in Markdown and HTML, and by
a `panel` whose first node is the "Fairlead technical context" heading in ADF.
On `update_issue` the connector reads the existing issue, replaces the block
(never appends a second one), keeps every node outside it as the tracker holds
it, and replaces that prose with the envelope `description` only when its text
differs from what is already there. `title` always overwrites. Jira also
refuses to update an issue outside its configured project.

### Results

`IntegrationResult.ok` reflects the target mutation only.
`IntegrationResult.attachments` (`AttachmentResult[]`, one per artifact, keyed
by `filename`) carries independent per-file outcomes: a command can be
`ok: true` with one or more failed attachments (partial success, decided
2026-09-21 in the source plan).

`IntegrationError.httpStatus` is limited to retry-safe upstream statuses
(`429`, `502`, `503`, `504`); `retryable: true` maps to `503` when no status is
supplied.

## Read path: `ReadOperation` → `ReadResult`

`Connector.read(operation)`, optional on the `Connector` interface (a
write-only connector need not implement it; every v1 issue-tracker
connector does). `ReadOperation` is `{ type: 'search', query, ... } |
{ type: 'fetch', id, ... }`. `ReadResult.issues` (search) /
`ReadResult.issue` (fetch) use the shared `IssueSummary` shape
(`id`, `title`, `url`, `status?`, `description?`). Additive — no protocol
version bump.

## Validation

Shape validation happens once, in the envelope decoder (`decodeEnvelope()`),
which also decodes the report. Whether the _specific_ resolved connector
supports the intent's action is a `ConnectorCapabilities` check
`bridge-worker` makes against the connector it resolved.

## Conformance testing

`@fairlead/bridge-core/conformance`'s `runConnectorConformanceTests()`
is a vitest suite factory a connector package's own test file calls
against its `Connector` implementation. Checks contract-level shape
(protocol version, non-empty capabilities, a round-trip `execute()` call, a typed
`unsupported_action` for an undeclared action)
— not provider-specific correctness, which belongs in that connector's own
tests.

## What's not yet in this contract

- Idempotency-key retry-safety (dedup, replay rejection) — v1 has no
  exactly-once guarantee; see the source plan's "Future idempotency
  invariants" for the design a later protocol version would need.
- A `bridge-runner` (private-mode) implementation — `bridge-worker` covers
  cloud mode only.
