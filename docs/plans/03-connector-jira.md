# 03 — connector-jira

**Status:** not started
**Depends on:** [01-stabilize-contract.md](01-stabilize-contract.md), [02-bridge-worker.md](02-bridge-worker.md)
**Related:** [06-retire-extension-direct-transport.md](06-retire-extension-direct-transport.md), [chrome-extension `docs/specs/issue-tracker-integration.md`](../../../chrome-extension/docs/specs/issue-tracker-integration.md)

## Why

Jira is one of the two trackers the extension already talks to directly
today (`jira-client.ts`) — this connector is what lets Bridge take over
that execution so `direct` can be retired (task 06). It is a port of
working logic, not new design: the provider behavior below already exists
in the extension and should be reused, not reinvented.

## Current behavior to preserve (from `chrome-extension`'s `jira-client.ts`)

- Cloud (API v3, ADF body) vs. Server/DC (API v2, Wiki Markup) detected via
  `.atlassian.net` in the URL, or an explicit `instanceType`. v1 protocol
  scope is Jira **Cloud** only (source plan) — confirm whether Server/DC
  detection is worth carrying into the connector now or left as a
  known gap, since the source plan's provider list names Jira Cloud only.
- Attachments: native binary upload, `POST /rest/api/{ver}/issue/{id}/attachments`.
- Distinct `create`/`update`/`add comment` (Jira has a real comment-vs-body
  distinction, unlike GitHub) / `search` / `fetch` / attach-attachment
  surface.

## Task

- New package `packages/connector-jira/`, implements `Connector` from
  `bridge-core`.
- `create_issue`/`update_issue`: map `title`/`description` (standard v1
  fields) to Jira's ADF body format for Cloud.
- `search`/`fetch` (the `ReadOperation` type from task 01) — needed by the
  extension's generic issue picker.
- Attachment handling: resolve the short-lived Data Plane evidence
  references from the command, retrieve the files, upload natively; report
  per-file results into `IntegrationResult.attachments` (partial-success
  decision, task 01) rather than failing the whole command on one bad file.
- Credential-validity check: `GET /myself` (source plan, "Protocol v1
  scope") — cheap, non-mutating, run at profile/project-selection
  checkpoint through Bridge.
- Capability manifest: `targets.issue` with actions `create`/`update`, reads
  `fetch`/`search` and `attachments` —
  explicitly not `transition_issue`, `test_case`, etc. (reserved, not
  implemented — see task 01).
- Credential resolution (OAuth token or pasted PAT) comes from
  `bridge-worker` per command, not stored in this package.

## Acceptance criteria

- [ ] Create/update produce the same ADF body shape the extension's
      `jira-client.ts` produces today, verified against a real Jira Cloud
      sandbox or recorded fixtures from the existing integration tests
      (`jira-client.integration.test.ts`).
- [ ] Attachment upload uses the native attachments endpoint; a failed
      attachment does not fail an otherwise-successful issue mutation.
- [ ] `GET /myself` credential check implemented and wired to the
      capability manifest.
- [ ] Conformance tests from `bridge-core` (task 01) pass against this
      connector's `execute()`.
