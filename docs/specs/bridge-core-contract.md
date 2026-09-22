# bridge-core contract

Current-state reference for `packages/bridge-core`'s wire contract. Design
rationale and decision history live in
[`../../../chrome-extension/docs/plans/integration-connector-gateway.md`](../../../chrome-extension/docs/plans/integration-connector-gateway.md)
("Generic integration contract", "Protocol v1 scope") — this file
describes the current shape, not why it looks this way.

## Protocol version

The public write wire format is `EnvelopeV1` in `src/envelope-v1.ts`, a union of
two commands. `create_issue` carries `subject` and `description`; `update_issue`
carries `issueId` and optional `subject` and `description`. Both carry
`protocolVersion`, `project_id` and `integration_instance_id`, and never a caller
identity, connector identity, connector configuration or report body.
`decodeEnvelope()` selects a registered version
decoder and maps the wire command to `InternalIntegrationCommand` (camel-cased
trusted routing fields). `SUPPORTED_PROTOCOL_VERSIONS` is the single
compatible-version set used by `isCompatibleProtocolVersion()`. A version not in
that set returns `error.code: 'unsupported_protocol_version'`, not an exception.
The extension sends its own version and learns nothing about Bridge's supported
versions in advance: every route (`/v1/commands`, `/v1/reads`, `/v1/attachments`, `/v1/credentials/check`)
answers an unknown `protocolVersion` with `400 unsupported_protocol_version`.

`MAX_SUBJECT_LENGTH` and `MAX_DESCRIPTION_LENGTH` (32 768 characters each) are
enforced while decoding. JSON command and read
bodies are read incrementally up to `MAX_JSON_REQUEST_BYTES` (256 KiB), a
transport safety limit. A version listed in `DEPRECATED_PROTOCOL_VERSIONS` still
answers normally; its `DeprecationNotice` (`successorVersion`, `endOfSupportAt`,
`message?`) is returned in `metadata.deprecation` of command and read results.
The table is empty until a successor version ships.

The Worker authenticates (Control Plane credential resolution, which needs only
`project_id` and `integration_instance_id`) before it decodes the command.

Frozen wire examples live in `packages/bridge-core/contract/v1/`. The decoder
test replays every request fixture in every stored version directory.

## Routes

| Route                        | Body                                                                               | Result               |
| ---------------------------- | ---------------------------------------------------------------------------------- | -------------------- |
| `POST /v1/commands`          | JSON `create_issue` / `update_issue`                                               | `IntegrationResult`  |
| `POST /v1/reads`             | JSON search / fetch operation                                                      | `ReadResult`         |
| `POST /v1/attachments`       | `multipart/form-data`: `meta` JSON part + one `file`                               | `AttachmentResult`   |
| `POST /v1/credentials/check` | JSON routing envelope (`protocolVersion`, `project_id`, `integration_instance_id`) | `{ valid: boolean }` |

All routes require a Bearer identity token.

Credential checks resolve the same caller credential and trusted connector
configuration as issue commands. `{ "valid": true }` means the provider
accepted the credential; `{ "valid": false }` means the check completed and
the provider rejected it. Resolution, routing, unsupported-check, and timeout
failures use the normal Bridge error envelope. The extension invokes this route
when a user selects a Bridge-backed tracker.

## Write path: `ConnectorCommand` → `IntegrationResult`

`Connector.execute(command, { signal })` takes a `ConnectorCommand`
(`src/command.ts`): the internal command without the routing fields. It carries
no caller, connector id or report body; Bridge resolves those from the Control
Plane record and the verified token. `ConnectorCapabilities.targets`
is hierarchical: per target kind (`issue`, `test_case`, `test_run`, `incident`) it
lists `actions` (mutations), `reads` (`fetch`/`search`) and optional
`attachments` and `verdictMappings`. Capability actions use short domain names
(`create`, `update`), not wire names; `COMMAND_OPERATION` maps each wire command
(`create_issue`, ...) to its `(target, action)` pair, and `supportsCommand()`
checks that pair. A new wire command adds one `COMMAND_OPERATION` entry; a new
target or action is a non-breaking manifest addition. The Worker answers an
undeclared pair with `unsupported_action` (422) and connectors do the same when
called directly. Only `issue` targets have a v1 connector implementation.

`TargetReference` reserves `test_case`, `test_run`, `incident` and `none`;
`transition_issue` stays distinct from the `update` action. These shapes do
not imply v1 provider support. A connector advertises only implemented
capabilities, and clients must tolerate additive capability fields they do
not recognize.

Every connector must pass the supplied abort signal to abortable provider
requests. A timeout remains an unknown provider-side outcome: an aborted
client request cannot prove that a provider mutation did not complete.

### Description updates

When an `update_issue` command includes `description`, it replaces the provider
description. An omitted `description` leaves it unchanged. Connectors convert
the supplied text to the provider representation: Markdown for GitHub, ADF for
Jira and HTML for Azure DevOps. Jira also refuses to update an issue outside its
configured project.

### GitHub Issues

The GitHub connector maps `subject` to the issue title and the supplied
`description` directly to the Markdown issue body on create and update. It
supports only the `issue` target: `create`/`update`, `fetch`/`search`, and
attachments. Credential validation calls `GET /user`; it does not mutate a
repository or issue. Issue transitions and test-management targets are not
implemented.

### Attachments

Attachments never travel with a command. `POST /v1/attachments` requires
`X-Fairlead-Project-Id` and `X-Fairlead-Integration-Instance-Id` routing headers,
and takes a bounded `meta` part (`MAX_ATTACHMENT_META_BYTES`, 16 KiB:
`protocolVersion`, `issueId`, `filename`, `contentType`) followed by one `file` part.
The Worker resolves the credential from the headers before reading the multipart
body, then streams the file through an incremental size check;
`request.formData()` is never used.

The multipart layout is strict, so a client cannot use `FormData` (a string part has no
`Content-Type`, and a `Blob` part gets `filename="blob"`) and must build the body itself:
`meta` first, as a non-file part (no `filename`) with `Content-Type: application/json`;
`file` second, with `filename` equal to `meta.filename` and `Content-Type` equal to
`meta.contentType`.

A file over `MAX_ATTACHMENT_BYTES` (5 MiB, interim until per-provider measurement) is
answered with `413 attachment_too_large` (`limitBytes`, `actualBytes`).

`Connector.attach(attachment, { signal })` replaces by `(issue, filename)`.
Jira and Azure DevOps upload the new file first, then remove the old one; a
failed cleanup returns `ok: true` with a `previous_version_not_removed`
warning. GitHub Issues has no native binary attachment endpoint, so GitHub
replaces the file by SHA through the Contents API, committing it to
`connector.settings.attachments_branch` (default `fairlead-attachments`).
The GitHub connector converts the Contents API `/blob/` URL to `/raw/` and
places it in a managed section of the issue body, preserving the surrounding
text. Images use Markdown image syntax for inline display; other files use
links. Repeated uploads of the same filename replace the file by SHA and
update that filename's entry in the body.

### Results

`IntegrationResult.ok` reflects the issue mutation only. A successful issue
mutation carries `issueId` (the provider identifier required by the separate
attachment route) and may carry `issueUrl` for presentation. Each upload
returns its own `AttachmentResult` from `POST /v1/attachments`; a failed
upload does not change the issue command result. Create and update are
synchronous single provider mutations. Protocol v1 does not guarantee
exactly-once execution: after a timeout or connection loss, the provider may
have completed the mutation, so the outcome is unknown and retrying may repeat
it. `IntegrationError.httpStatus` is limited to retry-safe
upstream statuses (`429`, `502`, `503`, `504`); `retryable: true` maps to `503`
when no status is supplied.

## Read path: `ReadOperation` → `ReadResult`

`Connector.read(operation)`, optional on the `Connector` interface (a
write-only connector need not implement it; every v1 issue-tracker
connector does). `ReadOperation` is `{ type: 'search', query, ... } |
{ type: 'fetch', id, ... }`. `ReadResult.issues` (search) /
`ReadResult.issue` (fetch) use the shared `IssueSummary` shape
(`id`, `title`, `url`, `status?`). In the current implementation, fetch may
also carry normalized `description`, provider-native `rawDescription`, and
attachment metadata (`id`, `filename`) for editing and managed-section
detection. It never carries attachment bytes. Search results remain summaries.

## Validation

Shape validation happens once, in the envelope decoder (`decodeEnvelope()`),
which returns a typed error (including `unsupported_protocol_version`) rather
than throwing for malformed input.
Whether the _specific_ resolved connector
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

- A `bridge-runner` (private-mode) implementation — `bridge-worker` covers
  cloud mode only.
