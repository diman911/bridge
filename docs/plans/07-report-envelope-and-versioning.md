# 07 — Report-envelope contract, multi-version support, CP-owned config

**Status:** DRAFT — proposed, not yet agreed. Nothing here is implemented.
**Depends on:** [01-stabilize-contract.md](01-stabilize-contract.md) (revises its output)
**Revises:** [01](01-stabilize-contract.md), [02](02-bridge-worker.md), [06](06-retire-extension-direct-transport.md), and the source plan's "Protocol v1 scope" / "Responsibility split" in [`chrome-extension/docs/plans/integration-connector-gateway.md`](../../../chrome-extension/docs/plans/integration-connector-gateway.md)

## Why

Three problems found while doing 06a (extension-side `Connector` adapters):

1. **Release cycles differ.** The extension ships through Chrome Web Store
   and lives on user machines for months; Bridge deploys continuously. A
   single strict `protocolVersion === 1` check means every contract change
   breaks installed extensions.
2. **The field-level contract is the wrong seam.** `IntegrationCommand`
   carries `title`/`description`/`evidence` refs, so every new thing a
   tracker issue should contain needs a contract change _and_ an extension
   release. It also assumes the recording lives in Data Plane
   (`data_plane_reference`) — but a user may never store to Data Plane.
3. **The extension sends things Bridge already knows.** `connectorId`,
   `projectContext`, `callerId` are supplied by the caller and then
   cross-checked against Control Plane (`bridge-worker` already resolves the
   connector from `resolved.connector.catalog_type` and the project/repo from
   `container_key`). Caller-supplied values are redundant at best and a trust
   problem at worst (source plan: never trust connector config supplied by
   the extension).

## Proposal

### D1 — Versioned wire, one implementation

- Version lives in the route: `POST /v1/commands`, later `/v2/commands`.
  Payload keeps `protocolVersion` for defence in depth; mismatch → `400`.
- **No per-version copies of handler code.** Each version has a thin
  _decoder_ that maps its wire shape onto a single internal model. Connectors,
  report mapping and Control Plane resolution exist once and speak only the
  internal model.
- Per-version artifacts that _are_ snapshotted: JSON schema and frozen
  request/response fixtures (`packages/bridge-core/contract/v1/…`), replayed in
  CI against the current worker so an old version cannot regress silently.
- `isCompatibleProtocolVersion` becomes membership in a supported set.
- **Support policy:** current + previous major, each with a published
  end-of-support date (CWS review lag means the window must be generous —
  proposal: 6 months after the successor ships). A deprecated version answers
  normally with a `deprecation` field in the response.
- **Discovery:** supported versions are returned in Control Plane routing data
  (or `GET /capabilities`); the extension picks the highest version both sides
  speak and tolerates unknown additive fields.
- Because nothing calls `bridge-worker` in production yet, the shape below is
  defined as **v1 in place** — no v1→v2 migration is needed now; the
  machinery exists so the _next_ change doesn't break installed clients.

### D2 — Envelope carrying the report; Bridge extracts

Replace the field-level `IntegrationCommand` with an envelope:

| Field                  | Source    | Notes                                                                                  |
| ---------------------- | --------- | -------------------------------------------------------------------------------------- |
| `project_id`           | extension | already used by `bridge-worker`                                                        |
| `tracker_instance_id`  | extension | from CP routing data                                                                   |
| `intent`               | extension | `{ action, target }` — `create_issue`, `update_issue`, `add_comment`; target id if any |
| `title`, `description` | extension | **user-authored** text (edited in the UI) — stays explicit, not derived                |
| `report`               | extension | the sanitized `Report` (`chrome-extension/src/core/types/report.ts`), schema-versioned |
| `options`              | extension | which evidence to attach (HAR, screenshots), tracker-agnostic flags                    |
| `idempotencyKey`       | extension | observability only in v1 (no dedup)                                                    |

Bridge owns: rendering the technical block from `report`, producing HAR and
screenshot files from it, provider formatting (ADF vs Markdown vs ADO HTML),
and — for updates — fetching the existing issue itself and merging (so the
extension no longer needs `rawDescription`).

Consequences:

- Mapping changes ship with a Bridge deploy, not a CWS release.
- Works with no Data Plane; `data_plane_reference` / `direct_attachment`
  evidence modes are dropped from the contract.
- The report's own `schema_version` becomes a versioning axis Bridge must
  decode (same decoder pattern as D1).
- **Privacy invariant changes.** `AGENTS.md` names Data Plane ingest as the
  extension's only outbound sink. This adds Bridge. Requires an ADR in
  `chrome-extension`, and confirmation that the report is fully sanitized
  _before_ it leaves the extension (it already is for Data Plane upload —
  verify it is the same code path).
- **Size.** HAR + screenshots can be large. Confirm the Worker request-body
  limit for the deployed plan, define a max envelope size and a
  `413`-with-guidance behaviour; option: strip heavy sections the tracker
  won't use (`options` selects them) client-side.
- **Responsibility split flips.** The source plan says the extension decides
  content and Bridge only transforms. Under D2, Bridge decides how a report
  becomes issue content; the extension still owns the user's title and
  description. The source plan section needs rewriting.

### D3 — Connector identity and config come from Control Plane

Removed from the request: `connectorId`, `projectContext`, `callerId`.

| Was in command   | Now                                                                    |
| ---------------- | ---------------------------------------------------------------------- |
| `connectorId`    | `resolved.connector.catalog_type` from `resolveBridgeCredential`       |
| `projectContext` | `resolved.connector.container_key` (Jira project / repo / ADO project) |
| `callerId`       | derived from the verified identity token                               |

The extension learns catalog type, display name and capabilities from CP
routing data — for UI only. `supportsCommand` in `bridge-worker` drops the
`command.connectorId !== capabilities.connectorId` check.

Open: per-user profile options that today live in the extension (GitHub
labels, attachments branch). Either move to CP tracker-instance/project
config or keep as explicit `options`. Recommendation: CP config if they are
per-project, `options` if per-report.

## Impact on existing work

| Artifact                                               | Change                                                                                                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bridge-core` `types.ts`, `validation.ts`, conformance | new envelope + internal model; `EvidenceReference`, `TargetReference` breadth kept only if still needed                                                                       |
| `bridge-core` `IssueSummary` extension (`cbf92d1`)     | `rawDescription`/`attachments` no longer needed for edit; keep `description`, review the rest                                                                                 |
| `bridge-worker`                                        | version-routed handlers/decoders, report mapping layer, drop connectorId check, derive callerId                                                                               |
| Connectors (03–05)                                     | receive the internal model, not the wire envelope                                                                                                                             |
| `chrome-extension` 06a adapters                        | `Jira/GithubDirectConnector` implement the old field-level `Connector`; superseded by an HTTP Bridge client — decide whether to keep them as the `direct` transport until 06b |
| `chrome-extension` vendored `bridge-contract/`         | shrinks to envelope + result types; drift check unchanged                                                                                                                     |
| Read path                                              | `bridge-worker` has only `POST /commands`; search/fetch need an endpoint (`/v1/reads`) — still open                                                                           |

## Open questions

- Is `Connector.read()` search/fetch worth its own versioned route, or a
  generic `POST /v1/query`?
- Should the response include a rendered preview so the UI can show what
  Bridge will file before submit?
- Where do the user's title/description edits diverge from the
  Bridge-rendered block on re-edit (round-tripping the Fairlead section)?
- End-of-support policy: confirm N/N−1 and 6 months with product.

## Proposed task split

1. Agree D1–D3 (this file) and update the source plan's contract sections.
2. ADR in `chrome-extension`: report leaves the extension to Bridge.
3. `bridge-core`: envelope, internal model, version registry, frozen fixtures.
4. `bridge-worker`: `/v1/commands` decoder, report mapping, CP-derived identity.
5. Connector packages adapt to the internal model.
6. Extension: HTTP Bridge client (replaces 06b's planned Connector wiring).
