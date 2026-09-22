# 06 — Retire the extension's `direct` transport for Jira/GitHub

**Status:** 06a done (2026-09-21, uncommitted) — 06b not started
**Depends on:** [bridge-core contract](../specs/bridge-core-contract.md) (including Jira Cloud connector behavior), [bridge-worker contract](../specs/bridge-worker.md)
**Superseded in part by:** [07-report-envelope-and-versioning.md](07-report-envelope-and-versioning.md) — the contract 06b switches to is the narrow issue contract, not field-level commands; 07 is accepted, so 06b targets an HTTP Bridge client sending text commands and attachment uploads, not `Connector` wiring; 06a's `Connector` adapters stay only as the transitional `direct` path.
**Related:** [chrome-extension plan — "Decision", "Delivery phases"](../../../chrome-extension/docs/plans/integration-connector-gateway.md), [chrome-extension `docs/specs/issue-tracker-integration.md`](../../../chrome-extension/docs/specs/issue-tracker-integration.md)

## Why

Decided 2026-09-21 (source plan, "Decision"): `direct` is cut for Jira and
GitHub in the same delivery that ships `bridge-worker`, not a later phase
— Azure DevOps was never going to be added to `direct`, and keeping two
transport paths alive for Jira/GitHub past this stage has no upside. **The
actual code change lives in `chrome-extension`, not here** — this file
tracks it in this repo because it's gated on 01-05 landing first, and
because the vendoring decision below is this repo's to make.

## Task

- **Use the vendored wire contract** from `bridge-core` in `chrome-extension`.
  The extension syncs types with `npm run bridge-contract:sync` and checks
  drift with `npm run bridge-contract:check`; `bridge-core` remains the
  source of truth.
- **In `chrome-extension`: introduce a shared `Connector` interface.**
  Today there is no `ITrackerClient` — `submit.ts` branches on
  `profile.bugTracker` and calls `jira-client.ts`/`github-client.ts`
  directly (`docs/specs/issue-tracker-integration.md`). Both clients
  implement `Connector` from the vendored contract.
- **Switch both from calling the tracker API directly to calling Bridge.**
  `jira-client.ts`/`github-client.ts` stop making outbound requests to
  Jira/GitHub themselves; they build an `IntegrationCommand` and send it to
  the resolved Bridge address (`bridge-worker`, per Control Plane routing
  — source plan, "Routing and configuration").
- **Remove the `direct` transport for Jira/GitHub once the Bridge path is
  verified working** — no coexistence period, matching the identity-token
  cutover's own precedent (`control-plane` task 12: clean cutover, no
  in-flight traffic to protect). Local/no-auth export behavior that never
  went through `direct` HTTP calls is unaffected and stays as-is.
- **Azure DevOps ships Bridge-only from the start** — no `direct` code
  path is ever written for it in `chrome-extension`.
- Update `docs/specs/issue-tracker-integration.md` (`chrome-extension`) to
  describe the post-cutover state (all three trackers via Bridge) once
  this lands, per that repo's Definition of Done.

## Acceptance criteria

- [ ] `chrome-extension` has no remaining direct outbound call to the Jira
      or GitHub API for issue creation/update (grep for the tracker
      hostnames in `jira-client.ts`/`github-client.ts` — should be gone
      from those files' request paths).
- [ ] Both connectors execute via `bridge-worker`, verified end-to-end
      against a real Jira Cloud and GitHub org.
- [ ] Azure DevOps ships with no `direct`-transport code in
      `chrome-extension` at any point.
- [ ] `docs/specs/issue-tracker-integration.md` updated to match.

## Staging

- **06a** (needs only 01): vendored contract + `Connector` adapters over the
  existing clients; `direct` unchanged. Landed in `chrome-extension`
  (`src/infrastructure/bridge-contract/`, `adapters/connectors/`). Required
  one additive contract change first: `IssueSummary` gained optional
  `description`, `rawDescription`, `attachments` (no protocol bump).
- **06b** (needs 02+03+04): switch call sites to Bridge, retire `direct`, ADO UI.

### Open for 06b (not covered by the contract today)

- Jira ADF-preserving update (`buildUpdatedAdfDescription`) — decide whether the
  merge moves into `connector-jira` or the extension sends a fully built body.
- Attachment list/delete and GitHub branch upload — under Bridge, attachments
  become `data_plane_reference` uploads (product behavior change, not a refactor).
- Connection test (`testGithubConnection`) — uses the Bridge credential check
  route; see [`bridge-core-contract.md`](../specs/bridge-core-contract.md).
