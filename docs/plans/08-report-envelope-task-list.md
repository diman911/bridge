# 08 — Task list: report-envelope contract (bridge repo)

**Status:** in progress
**Source design:** [07-report-envelope-and-versioning.md](07-report-envelope-and-versioning.md) (accepted), [chrome-extension ADR-011](../../../chrome-extension/docs/architecture/decisions/ADR-011-report-to-bridge.md)
**Counterpart list:** [chrome-extension `docs/plans/bridge-report-envelope-tasks.md`](../../../chrome-extension/docs/plans/bridge-report-envelope-tasks.md)

Working checklist for implementing plan 07 in this repo. Task ids (`B1`…)
are referenced by the extension-side list. Update the checkboxes as work
lands; details and rationale stay in 07.

## Tasks

- [x] **B1 — `bridge-core` envelope and versioning.** Depends on: none.
  - Wire types: `EnvelopeV1` (`protocolVersion`, `project_id`,
    `tracker_instance_id`, `intent`, `title`, `description`, `report`,
    `options`, `idempotencyKey`), `EnvelopeIntent`, `EvidenceOptions`.
    No `connectorId`, `projectContext` or `callerId`.
  - Internal model the connectors consume, independent of the wire shape.
  - Constants: supported-version set (replaces `=== PROTOCOL_VERSION` in
    `isCompatibleProtocolVersion`), `MAX_ENVELOPE_BYTES`, text limits.
  - `DeprecationNotice` and a response-metadata field for it.
  - Decoder for v1 and a version → decoder registry.
  - Keep wire-only types in a file the extension can vendor verbatim
    (no decoding logic in it).
- [x] **B2 — Frozen fixtures and contract tests.** Depends on: B1.
  - `packages/bridge-core/contract/v1/` request and response fixtures.
  - CI replays every stored version's request fixtures through the current
    decoder and `/v1/commands` Worker.
  - Connector conformance moves with B6, when the remaining legacy adapter
    is removed.
- [x] **B3 — Report decoding.** Depends on: B1, decision on schema source.
  - Decide how Bridge gets the `Report` schema (copy of extension types,
    or a JSON Schema owned by one side and generated for the other).
  - Support the current and previous report `schema_version`; reject
    others with a typed error.
  - Minimal typed view of the report fields Bridge needs.
- [x] **B4 — Report → issue mapping.** Depends on: B1, B3.
  - Render the technical block from the report.
  - Produce HAR and screenshot files from the report per `options`.
  - Provider formatters: Jira (ADF), GitHub (Markdown), Azure DevOps.
  - Bridge must not log or persist report bodies (ADR-011).
- [x] **B5 — `bridge-worker` endpoints.** Depends on: B1, B4, control-plane C3.
  - `POST /v1/commands` and `POST /v1/reads`, version chosen by route,
    body `protocolVersion` must match.
  - `413` when the envelope exceeds `MAX_ENVELOPE_BYTES`.
  - Derive connector type and container from the resolved Control Plane
    record; derive caller from the verified token.
  - Remove the `command.connectorId !== capabilities.connectorId` check.
  - Return `deprecation` for versions inside their end-of-support window.
- [ ] **B6 — Connectors 03–05 on the internal model.** Depends on: B1, B4.
  - Jira, GitHub, Azure DevOps take the internal model, not the old
    `IntegrationCommand`.
  - Update flow: connector reads the existing issue and merges (Jira ADF
    preserved) instead of receiving `rawDescription` from the caller.
  - Attachments come from the report; attachment failure remains partial
    success.
  - Credential-validity check stays per connector.
- [x] **B7 — Measure the Worker request-body limit.** Depends on: none.
  - Confirm the limit for the deployed plan and set `MAX_ENVELOPE_BYTES`
    from it (ADR-011, decision 5).
- [ ] **B8 — Specs and plan hygiene.** Depends on: B1–B6 as they land.
  - Update `docs/specs/bridge-core-contract.md` to the shipped envelope.
  - Update the cloud deployment runbook for new routes.
  - Revisit `IssueSummary.rawDescription` / `attachments` (added for the
    superseded edit flow); remove if unused.
  - Correct the status in `02-bridge-worker.md` (code exists; the file
    still says "not started").
  - Retire the old field-level `IntegrationCommand` once nothing uses it.

## External dependencies (other repos)

- **control-plane C3** — `resolveBridgeCredential` must return the caller
  identity (user id) so Bridge can stop trusting a caller-supplied id.
  See the control-plane list in
  [chrome-extension tasks](../../../chrome-extension/docs/plans/bridge-report-envelope-tasks.md).

## Order

`B1` and `B7` can start now. `B2` and `B3` follow `B1`. `B4` follows
`B3`. `B5` and `B6` follow `B4`. `B8` runs alongside.
