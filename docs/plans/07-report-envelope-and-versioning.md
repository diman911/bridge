# 07 — Narrow issue contract, attachment commands, multi-version support, CP-owned config

_(File name kept from the first draft, which proposed sending the whole
report; that design was dropped — see "History" — the name stays so links
remain stable.)_

**Status:** Accepted — nothing here is implemented yet. Task list: [08](08-report-envelope-task-list.md).
**Depends on:** [01-stabilize-contract.md](01-stabilize-contract.md) (revises its output)
**Revises:** [01](01-stabilize-contract.md), [02](02-bridge-worker.md), [06](06-retire-extension-direct-transport.md), and the source plan's "Protocol v1 scope" in [`chrome-extension/docs/plans/integration-connector-gateway.md`](../../../chrome-extension/docs/plans/integration-connector-gateway.md)
**Decision record (extension side):** [ADR-012](../../../chrome-extension/docs/architecture/decisions/ADR-012-narrow-bridge-contract.md)

## Why

Found while doing 06a (extension-side `Connector` adapters):

1. **Release cycles differ.** The extension ships through Chrome Web Store
   and stays installed for months; Bridge deploys continuously. A strict
   `protocolVersion === 1` check breaks installed extensions on every
   contract change.
2. **The extension sends things Bridge already knows.** `connectorId`,
   `projectContext`, `callerId` are supplied by the caller and cross-checked
   against Control Plane (`bridge-worker` already resolves the connector
   from `resolved.connector.catalog_type` and the container from
   `container_key`). Caller-supplied values are redundant and a trust
   problem (source plan: never trust connector config supplied by the
   extension).
3. **Evidence must not depend on Data Plane.** A user may never store a
   session there, so a `data_plane_reference` cannot be the only way to
   carry a HAR or screenshot.
4. **The contract for a tracker should be narrow.** A tracker needs a
   subject, a description and files — not the whole recording.

## Decisions

### D1 — Versioned wire, one implementation

- Version lives in the route: `POST /v1/commands`, `POST /v1/attachments`,
  `POST /v1/reads`; later `/v2/…`. JSON payloads also carry `protocolVersion`
  as defence in depth; mismatch → `400`.
- **No per-version copies of handler code.** Each version has a thin
  _decoder_ mapping its wire shape onto one internal model. Connectors and
  Control Plane resolution exist once and speak only the internal model.
- Snapshotted per version: JSON schema and frozen request/response fixtures
  (`packages/bridge-core/contract/v1/…`), replayed in CI against the current
  worker so an old version cannot regress silently.
- `isCompatibleProtocolVersion` is membership in a supported set.
- **Support policy:** current + previous major; 6 months after a successor
  ships (CWS review lag). A version inside its window answers normally with
  `metadata.deprecation`:

  ```json
  { "successorVersion": 2, "endOfSupportAt": "2027-03-01", "message": "…" }
  ```

- **Discovery:** supported versions are part of Control Plane routing data
  (or `GET /capabilities`); the extension picks the highest version both
  sides speak and tolerates unknown additive fields.
- Nothing calls `bridge-worker` in production yet, so the shape below is
  defined as **v1 in place** — no v1→v2 migration now; the machinery exists
  so the _next_ change doesn't break installed clients.

### D2 — Narrow contract: text commands and separate attachment commands

Bridge never receives a `Report`. It receives text and files.

**`POST /v1/commands`** (JSON) — two commands:

| Field                                                                      | `create_issue` | `update_issue` | Notes                                                        |
| -------------------------------------------------------------------------- | -------------- | -------------- | ------------------------------------------------------------ |
| `protocolVersion`                                                          | ✔              | ✔              |                                                              |
| `project_id`                                                               | ✔              | ✔              | from the extension's session                                 |
| `integration_instance_id`                                                  | ✔              | ✔              | from CP routing data                                         |
| `type`                                                                     | `create_issue` | `update_issue` |                                                              |
| `issueId`                                                                  | —              | ✔              | provider issue key/number                                    |
| `subject`                                                                  | ✔              | optional       | max length per `bridge-core` constant                        |
| `description`                                                              | ✔              | optional       | Markdown, user-authored; provider conversion is Bridge's job |
| **`POST /v1/attachments`** (`multipart/form-data`) — one file per request: |

- Headers: `X-Fairlead-Project-Id`, `X-Fairlead-Integration-Instance-Id`.
- Part `meta` (JSON): `protocolVersion`, `issueId`, `filename`, `contentType`.
- Part `file`: the bytes.
- Idempotent by `(issue, filename)`: uploading the same filename to the same
  issue replaces the earlier file. This also covers re-submits after an
  update, so no list/delete-attachment operation is part of the contract.
- One file per request keeps per-file limits, per-file retry and partial
  success natural: the issue exists first; each attachment reports its own
  result. A failed attachment never invalidates the issue.
- The provider mechanism is the connector's business (Jira native upload;
  GitHub has no issue-attachment API, so the connector commits to a
  configured branch and links — configuration from Control Plane, see D3;
  Azure DevOps attachments API).

**`POST /v1/reads`** — search / fetch, unchanged in intent. `IssueSummary`
carries `id`, `title`, `url`, `status?` and (on fetch) `description?`; no
provider-native raw description or attachment listing is exposed.

**Description updates.** `description` is the complete user-authored issue
body. On update, an omitted value leaves the provider description unchanged;
a supplied value replaces it. Bridge converts the text into the provider's
native representation.

**Limits.** Text fields have length limits; each attachment has
`MAX_ATTACHMENT_BYTES`. Both are named constants in `bridge-core`, measured
against the Worker limits (task B7) and set below the platform cap —
Cloudflare answers an oversize body with its own `413` before application
code runs, so a structured error
`{ code: 'attachment_too_large', limitBytes, actualBytes }` only works below
that cap. The extension prechecks size with the same constants.

### D3 — Connector identity and config come from Control Plane

Removed from every request: `connectorId`, `projectContext`, `callerId`.

| Was in command   | Now                                                                    |
| ---------------- | ---------------------------------------------------------------------- |
| `connectorId`    | `resolved.connector.catalog_type` from `resolveBridgeCredential`       |
| `projectContext` | `resolved.connector.container_key` (Jira project / repo / ADO project) |
| `callerId`       | derived from the verified identity token                               |

The extension learns catalog type, display name and capabilities from CP
routing data — for UI only. `supportsCommand` in `bridge-worker` drops the
`command.connectorId !== capabilities.connectorId` check.

Per-user profile options that live in the extension today (GitHub labels,
attachments branch) move to per-project tracker configuration in Control
Plane.

## Impact on existing work

| Artifact                                               | Change                                                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `bridge-core` envelope/decoder work started on disk    | Reshape to the commands above; drop the `report` field                                                                        |
| `bridge-core` report decoding and report→issue mapping | Not needed under D2; remove. The description-merge helpers (Markdown/HTML/ADF block merge) are reusable for the managed block |
| `bridge-worker`                                        | `/v1/commands`, `/v1/attachments`, `/v1/reads`; CP-derived identity; drop `connectorId` check                                 |
| Connectors (03–05)                                     | Internal model; update reads the existing issue and merges the block; attachment upload                                       |
| `chrome-extension` 06a adapters                        | Field-level `Connector` adapters stay only as the transitional `direct` path; 06b becomes an HTTP Bridge client               |
| `chrome-extension` vendored `bridge-contract/`         | Shrinks to wire types and constants; drift check unchanged                                                                    |

## Open points

- Product confirmation of the N/N−1 and 6-month policy.
- Exact numeric limits (request body, per-attachment) after task B7.
- Whether the Worker can stream an attachment to the provider within its
  memory/CPU limits for the largest expected HAR; if not, define a
  per-attachment ceiling accordingly.

## History

- 2026-09-21 first draft: whole `Report` sent to Bridge (ADR-011). Dropped
  the same day — it widened what leaves the device, added a second
  versioning axis (report `schema_version`) and a request-size problem for
  no gain over sending only what a tracker needs. Replaced by D2 above.
