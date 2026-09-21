# 08 — Task list: issue contract (bridge repo)

_(File name kept from the first draft so links stay stable; the report-envelope
design was replaced by the narrow contract in 07 — see "Phase 1".)_

**Status:** Phase 1 done and superseded; Phase 2 (rework to the narrow contract) not started
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
| Description merge helpers (`description.ts`: Markdown/HTML/ADF)                           | **Keep**, adapt to the managed block (B11)                  |
| Connectors on the internal command model, update reads existing issue and merges          | **Keep**, change the input model (B9, B11)                  |
| Separate attachment deadline, parallel uploads                                            | **Keep the ideas**, rebuild on an uploaded-bytes path (B12) |
| `report` field in the envelope, report decoding, `mapReportToIssue`, `MAX_ENVELOPE_BYTES` | **Remove** (B9, B10)                                        |
| Attachments generated from the report                                                     | **Replace** with uploaded bytes (B12)                       |

## Phase 2 — narrow contract

- [ ] **B9 — Reshape wire types and decoder.** Depends on: none.
  - `create_issue` / `update_issue` commands per 07 D2: `subject`,
    `description`, `technicalSection`, `issueId`, `onConflict`,
    `idempotencyKey`, `project_id`, `tracker_instance_id`, `protocolVersion`.
    No `report`, `options`, `connectorId`, `projectContext`, `callerId`.
  - Wire-only types stay in a file the extension can vendor verbatim.
  - Internal command model updated accordingly.
  - v1 is redefined in place (nothing shipped): replace the frozen fixtures
    and keep the CI replay.
- [ ] **B10 — Remove report handling.** Depends on: B9.
  - Delete report decoding, report → issue mapping, report schema-version
    constants and envelope-size constants; update exports.
  - Keep the text-length limits.
- [ ] **B11 — Managed block semantics.** Depends on: B9.
  - Block = fenced Markdown with info string `fairlead` (compatible with
    issues filed by the current extension).
  - `update_issue`: intact block → replace; no block → append; malformed
    block → `409 description_conflict`; retry with `onConflict`
    (`append` | `replace`).
  - Omitted `description` edits only the block and `subject` (Jira ADF
    preserved).
  - Tests per provider (Jira ADF, GitHub Markdown, Azure DevOps HTML).
- [ ] **B12 — `POST /v1/attachments`.** Depends on: B9, control-plane C3.
  - `multipart/form-data`: `meta` JSON part + `file` part, one file per
    request; validate `meta` (version, project, tracker instance, issue id,
    filename, content type).
  - Idempotent replace by `(issue, filename)`.
  - Per-file limit `MAX_ATTACHMENT_BYTES`; structured
    `413 attachment_too_large` for sizes below the platform cap.
  - Stream to the provider where the Worker allows; connectors take bytes
    instead of report-derived files. GitHub: commit to the configured branch
    (config from control-plane C4); Azure DevOps attachments API; Jira native.
  - Authenticate and resolve identity before reading the body.
- [ ] **B13 — Deprecation format.** Depends on: B9.
  - `metadata.deprecation = { successorVersion, endOfSupportAt, message? }`,
    replacing the field names used so far.
- [ ] **B14 — Re-measure limits.** Depends on: B12.
  - Per-attachment ceiling given Worker memory/CPU when streaming to each
    provider; set `MAX_ATTACHMENT_BYTES` below the platform request cap.
- [ ] **B15 — Specs and hygiene.** Depends on: B9–B12.
  - Update `docs/specs/bridge-core-contract.md` and the deployment runbook
    to the narrow contract and the three routes.
  - Confirm `IssueSummary` carries no raw description or attachment list.
  - Correct stale notes in `02-bridge-worker.md`.
  - Retire the old field-level `IntegrationCommand` if anything still uses it.

## Follow-ups

- Attachments are idempotent by filename (replace); commands still have no
  deduplication by `idempotencyKey` (v1 decision).

## External dependencies (other repos)

- **control-plane C3** — `resolveBridgeCredential` returns the caller
  identity (user id).
- **control-plane C4** — per-project GitHub labels and attachments branch.
  See the control-plane list in
  [chrome-extension tasks](../../../chrome-extension/docs/plans/bridge-report-envelope-tasks.md).

## Order

`B9` first. Then `B10`, `B11`, `B12`, `B13` in parallel. `B14` after `B12`.
`B15` alongside.
