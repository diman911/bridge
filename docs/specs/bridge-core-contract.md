# bridge-core contract

Current-state reference for `packages/bridge-core`'s wire contract. Design
rationale and decision history live in
[`../../../chrome-extension/docs/plans/integration-connector-gateway.md`](../../../chrome-extension/docs/plans/integration-connector-gateway.md)
("Generic integration contract", "Protocol v1 scope") — this file
describes the current shape, not why it looks this way.

## Protocol version

The public write wire format is `EnvelopeV1` in `src/envelope-v1.ts`, a union of
two commands. `create_issue` carries `subject`, `description` and optional
`technicalSection`; `update_issue` carries `issueId`, optional `subject`,
`description`, `technicalSection` and `onConflict` (`append` | `replace`). Both
carry `protocolVersion`, `project_id`, `tracker_instance_id` and
`idempotencyKey`, and never a caller identity, connector identity, connector
configuration or report body. `decodeEnvelope()` selects a registered version
decoder and maps the wire command to `InternalIntegrationCommand` (camel-cased
trusted routing fields). `SUPPORTED_PROTOCOL_VERSIONS` is the single
compatible-version set used by `isCompatibleProtocolVersion()`. A version not in
that set returns `error.code: 'unsupported_protocol_version'`, not an exception.
The extension sends its own version and learns nothing about Bridge's supported
versions in advance: every route (`/v1/commands`, `/v1/reads`, `/v1/attachments`)
answers an unknown `protocolVersion` with `400 unsupported_protocol_version`.

`MAX_SUBJECT_LENGTH`, `MAX_DESCRIPTION_LENGTH` and `MAX_TECHNICAL_SECTION_LENGTH`
(32 768 characters each) are enforced while decoding. JSON command and read
bodies are read incrementally up to `MAX_JSON_REQUEST_BYTES` (256 KiB), a
transport safety limit. A version listed in `DEPRECATED_PROTOCOL_VERSIONS` still
answers normally; its `DeprecationNotice` (`successorVersion`, `endOfSupportAt`,
`message?`) is returned in `metadata.deprecation` of command and read results.
The table is empty until a successor version ships.

The Worker authenticates (Control Plane credential resolution, which needs only
`project_id` and `tracker_instance_id`) before it decodes the command.

Frozen wire examples live in `packages/bridge-core/contract/v1/`. The decoder
test replays every request fixture in every stored version directory.

## Routes

| Route                  | Body                                                 | Result                                  |
| ---------------------- | ---------------------------------------------------- | --------------------------------------- |
| `POST /v1/commands`    | JSON `create_issue` / `update_issue`                 | `IntegrationResult`                     |
| `POST /v1/reads`       | JSON search / fetch operation                        | `ReadResult`                            |
| `POST /v1/attachments` | `multipart/form-data`: `meta` JSON part + one `file` | `AttachmentResult` (+ `idempotencyKey`) |

All three require a Bearer identity token.

## Write path: `ConnectorCommand` → `IntegrationResult`

`Connector.execute(command, { signal })` takes a `ConnectorCommand`
(`src/command.ts`): the internal command without the routing fields. It carries
no caller, connector id or report body; Bridge resolves those from the Control
Plane record and the verified token. `ConnectorCapabilities.supportedActions`
is a subset of `CommandType` (`create_issue`, `update_issue`); the Worker answers
an undeclared action with `unsupported_action` (422) and connectors do the same
when called directly. Only `issue` targets have a v1 connector implementation.

Every connector must pass the supplied abort signal to abortable provider
requests. A timeout remains an unknown provider-side outcome: an aborted
client request cannot prove that a provider mutation did not complete.

### Managed block and update merge

`src/description.ts` owns the provider formatters, so the block logic is not
repeated per connector: `mergeAdf` (Jira), `mergeMarkdown` (GitHub) and
`mergeHtml` (Azure DevOps). The technical section is stored as a managed
"fairlead" block: fenced Markdown with info string `fairlead` on GitHub, a
`<pre><code class="language-fairlead">` block in Azure DevOps HTML, and a `codeBlock`
with language `fairlead` in Jira ADF.

On `update_issue` the connector reads the existing issue and merges:

- intact block → replaced with `technicalSection`; no block → appended;
- omitted `description` edits only the block and `subject` (Jira ADF is kept);
- malformed block → `409 description_conflict`; the caller retries with
  `onConflict`. `append` keeps the malformed text and adds a block only for a
  non-empty `technicalSection`. `replace` requires `description` and replaces
  the whole description, adding a block only for a non-empty `technicalSection`;
- an omitted `technicalSection` leaves the block untouched, an empty one removes it.

Jira also refuses to update an issue outside its configured project.

### Attachments

Attachments never travel with a command. `POST /v1/attachments` takes a bounded
`meta` part (`MAX_ATTACHMENT_META_BYTES`, 16 KiB: `protocolVersion`, `project_id`,
`tracker_instance_id`, `issueId`, `filename`, `contentType`, `idempotencyKey`)
followed by one `file` part. The Worker authenticates the token before reading
the body, resolves the credential from `meta`, cross-checks the returned
`caller_id`, then streams the file through an incremental size check;
`request.formData()` is never used.

The multipart layout is strict, so a client cannot use `FormData` (a string part has no
`Content-Type`, and a `Blob` part gets `filename="blob"`) and must build the body itself:
`meta` first, as a non-file part (no `filename`) with `Content-Type: application/json`;
`file` second, with `filename` equal to `meta.filename` and `Content-Type` equal to
`meta.contentType`.

A file over `MAX_ATTACHMENT_BYTES` (5 MiB, interim until per-provider measurement) is
answered with `413 attachment_too_large` (`limitBytes`, `actualBytes`).

`Connector.attach(attachment, { signal })` replaces by `(issue, filename)`:
upload the new file first, delete the old one second. A failed upload keeps the
old file. A failed cleanup returns `ok: true` with a `previous_version_not_removed`
warning; replacement is not atomic. Jira uses its native attachment API, Azure
DevOps its attachments API linked to the work item, and GitHub commits the file
to `connector.settings.attachments_branch`.

### Results

`IntegrationResult.ok` reflects the issue mutation only; it carries no
attachment outcomes. `IntegrationError.httpStatus` is limited to retry-safe
upstream statuses (`429`, `502`, `503`, `504`); `retryable: true` maps to `503`
when no status is supplied.

## Read path: `ReadOperation` → `ReadResult`

`Connector.read(operation)`, optional on the `Connector` interface (a
write-only connector need not implement it; every v1 issue-tracker
connector does). `ReadOperation` is `{ type: 'search', query, ... } |
{ type: 'fetch', id, ... }`. `ReadResult.issues` (search) /
`ReadResult.issue` (fetch) use the shared `IssueSummary` shape
(`id`, `title`, `url`, `status?`). It carries no raw description or
attachment list. Additive — no protocol version bump.

## Validation

Shape validation happens once, in the envelope decoder (`decodeEnvelope()`).
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

- Idempotency-key retry-safety (dedup, replay rejection) — v1 has no
  exactly-once guarantee; see the source plan's "Future idempotency
  invariants" for the design a later protocol version would need.
- A `bridge-runner` (private-mode) implementation — `bridge-worker` covers
  cloud mode only.
