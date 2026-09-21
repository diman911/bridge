# 08 — Task list: issue contract (bridge repo)

_(File name kept from the first draft so links stay stable; the report-envelope
design was replaced by the narrow contract in 07 — see "Phase 1".)_

**Status:** Phase 1 done and superseded; Phase 2 implemented in Bridge; control-plane dependencies landed (control-plane `e5ea258`)
**Source design:** [07-report-envelope-and-versioning.md](07-report-envelope-and-versioning.md) (accepted), [chrome-extension ADR-012](../../../chrome-extension/docs/architecture/decisions/ADR-012-narrow-bridge-contract.md)
**Counterpart list:** [chrome-extension `docs/plans/bridge-report-envelope-tasks.md`](../../../chrome-extension/docs/plans/bridge-report-envelope-tasks.md)

Task ids (`B…`) are referenced by the extension-side list. Update the
checkboxes as work lands; details and rationale stay in 07.

## Phase 1 — report envelope (done, superseded)

B1–B8 implemented the first draft of 07, where the extension sent the whole
sanitized `Report` and Bridge decoded it and generated attachments. That
design was dropped (07, "History"). What survives and what does not:

| Delivered in Phase 1                                                                      | Fate                                                        |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Version set + `isCompatibleProtocolVersion`, decoder registry, response metadata          | **Keep** (D1)                                               |
| Frozen fixtures and replay tests (`contract/v1/`)                                         | **Keep the mechanism**, replace fixtures (B9)               |
| CP-derived identity, `connectorId` check removed, authenticate-before-decode              | **Keep** (D3)                                               |
| Description merge helpers (`description.ts`: Markdown/HTML/ADF)                           | **Remove**; descriptions are complete replacements          |
| Connectors on the internal command model, update reads existing issue and merges          | **Keep**, change the input model (B9)                       |
| Separate attachment deadline, parallel uploads                                            | **Keep the ideas**, rebuild on an uploaded-bytes path (B12) |
| `report` field in the envelope, report decoding, `mapReportToIssue`, `MAX_ENVELOPE_BYTES` | **Remove** (B9, B10)                                        |
| Attachments generated from the report                                                     | **Replace** with uploaded bytes (B12)                       |

## Phase 2 — narrow contract

- [x] **B9 — Reshape wire types and decoder.** Depends on: none.
  - `create_issue` / `update_issue` commands per 07 D2: `subject`,
    `description`, `issueId`, `project_id`, `integration_instance_id`,
    `protocolVersion`.
    No `report`, `options`, `connectorId`, `projectContext`, `callerId`.
  - Wire-only types stay in a file the extension can vendor verbatim.
  - Internal command model updated accordingly.
  - v1 is redefined in place (nothing shipped): replace the frozen fixtures
    and keep the CI replay.
  - JSON command/read bodies have a separate transport safety limit and are
    read incrementally up to that limit before parsing. This is distinct from
    the removed report-envelope ceiling.
- [x] **B10 — Remove report handling.** Depends on: B9.
  - Delete report decoding, report → issue mapping, report schema-version
    constants and envelope-size constants; update exports.
  - Keep the text-length limits.
- [x] **B12 — `POST /v1/attachments`.** Depends on: B9, control-plane C3.
  - `multipart/form-data`: `meta` JSON part + `file` part, one file per
    request; routing headers carry project and integration instance; validate
    `meta` (version, issue id, filename, content type).
  - Idempotent replace by `(issue, filename)`.
  - Per-file limit `MAX_ATTACHMENT_BYTES`; structured
    `413 attachment_too_large` for sizes below the platform cap.
  - Stream to the provider where the Worker allows; connectors take bytes
    instead of report-derived files. GitHub: commit to the configured branch
    (config from control-plane C4); Azure DevOps attachments API; Jira native.
  - Resolve the credential/config from routing headers before reading the
    body. Require the bounded `meta` part first, then stream the `file` part
    with an incremental size check; do not use
    `request.formData()`, which buffers the complete multipart body.
  - Replacement is upload-new-first, delete-old-second. A failed upload keeps
    the old file. A failed cleanup after upload returns success plus a
    structured `previous_version_not_removed` warning; replacement is not
    atomic.
- [x] **B13 — Deprecation format.** Depends on: B9.
  - `metadata.deprecation = { successorVersion, endOfSupportAt, message? }`,
    replacing the field names used so far.
- [x] **B14 — Re-measure limits.** Depends on: B12.
  - Closed on an interim decision: `MAX_ATTACHMENT_BYTES` is fixed at 5 MiB for
    all providers. Measuring is deferred; raise or split per provider only with
    data (GitHub buffers and base64-encodes, so it is the binding case).
  - Deferred measurement: per-attachment ceiling given Worker memory/CPU when
    streaming to each provider, kept below the platform request cap.
- [x] **B15 — Specs and hygiene.** Depends on: B9–B12.
  - Update `docs/specs/bridge-core-contract.md` and the deployment runbook
    to the narrow contract and the three routes.
  - Confirm `IssueSummary` carries no raw description or attachment list.
  - Correct stale notes in `02-bridge-worker.md`.
  - Retire the old field-level `IntegrationCommand` if anything still uses it.
  - Done: `attachmentSignal`, `IntegrationResult.attachments` and
    `IssueSummary.description` removed; the worker has a single deadline.

## External dependencies (other repos)

The Control Plane supplies `connector.settings.attachments_branch` in
`resolveBridgeCredential`; the shape matches what `bridge-worker` calls.

- **control-plane C4** — per-project GitHub labels and attachments branch.
  Bridge expects the resolved connector config to expose it as
  `connector.settings.attachments_branch`.
  See the control-plane list in
  [chrome-extension tasks](../../../chrome-extension/docs/plans/bridge-report-envelope-tasks.md).
- **Attachment routing** — `/v1/attachments` sends `project_id` and
  `integration_instance_id` as routing headers, so `resolveBridgeCredential`
  runs before the multipart body is read.

## Order

`B9` first. Then `B10`, `B12`, `B13` in parallel. `B14` after `B12`.
`B15` alongside.
