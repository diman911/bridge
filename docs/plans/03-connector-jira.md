# 03 — connector-jira

**Status:** in progress — implementation and local tests exist; live validation and extension parity remain open
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
- Attachment handling: `/v1/attachments` supplies one file per request after
  issue mutation; upload natively and return a per-file `AttachmentResult`.
  An upload failure does not change the preceding command result (task 07).
- Credential-validity check: `GET /myself` (source plan, "Protocol v1
  scope") — cheap and non-mutating. The connector implements the check;
  profile/project-selection wiring is still open below.
- Capability manifest: `targets.issue` with actions `create`/`update`, reads
  `fetch`/`search` and `attachments` —
  explicitly not `transition_issue`, `test_case`, etc. (reserved, not
  implemented — see task 01).
- Credential resolution (OAuth token or pasted PAT) comes from
  `bridge-worker` per command, not stored in this package.

## Acceptance criteria

- [x] Create/update map descriptions to Jira Cloud ADF. The paragraph and
      line-break mapping is checked in `packages/connector-jira/src/index.test.ts`.
- [ ] Confirm ADF parity with the former extension `jira-client.ts` using
      recorded fixtures or a real Jira Cloud sandbox. The mapping test alone
      does not establish parity with the former client.
- [x] Attachment upload uses Jira's native `/rest/api/3/issue/{id}/attachments`
      endpoint. `attach()` returns a per-file result; `/v1/attachments` is a
      separate request after issue mutation, so upload failure cannot undo
      a successful create/update. Covered by the connector and Worker tests.
- [x] `checkCredential()` calls `GET /rest/api/3/myself`; the real Jira
      connector suite includes a credential check but is credential-gated.
- [x] Wire credential validation into the profile/project-selection flow.
      The extension checks the selected integration through
      `POST /v1/credentials/check`; the Worker resolves credentials via CP and
      invokes the connector's `checkCredential()`.
- [x] `bridge-core` conformance tests are registered against this
      connector's `execute()` in `packages/connector-jira/src/index.test.ts`.
- [ ] Run the credential-gated Jira Cloud connector E2E suite and confirm
      create/update, reads, attachment replacement and credential checks
      against a dedicated test project.
