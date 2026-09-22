# 04 — connector-github

**Status:** in progress — implementation and local tests exist; live validation and extension parity remain open
**Depends on:** [01-stabilize-contract.md](01-stabilize-contract.md), [02-bridge-worker.md](02-bridge-worker.md)
**Related:** [06-retire-extension-direct-transport.md](06-retire-extension-direct-transport.md), [chrome-extension `docs/specs/issue-tracker-integration.md`](../../../chrome-extension/docs/specs/issue-tracker-integration.md)

## Why

GitHub is the other tracker the extension already talks to directly today
(`github-client.ts`) — same rationale as
[03-connector-jira.md](03-connector-jira.md): a port of working behavior,
not new design.

## Current behavior to preserve (from `chrome-extension`'s `github-client.ts`)

- Markdown description body, not ADF/Wiki Markup.
- Attachments have **no native binary-attachment API on GitHub Issues** —
  today's extension commits screenshots to a dedicated branch in the same
  repo (`ensureGithubAttachmentsBranch()` + `uploadAttachmentToGithub()`,
  branch name `Profile.github.attachmentsBranch`, default
  `fairlead-attachments`) via the Contents API, then links with a `/raw/`
  URL. This is GitHub's actual "native attachment mechanism" for this
  connector, per the source plan's "Responsibility split" ("Bridge
  retrieves those files and attaches them using the connector's native
  attachment mechanism" — for GitHub that mechanism is the branch-commit
  path, not a literal upload endpoint, since none exists).
- No distinct comment-vs-body concept — `add_comment` may not map onto
  GitHub the same way it does for Jira; confirm during implementation
  whether it's a no-op capability or maps to GitHub's actual issue-comment
  API (which does exist, separate from the issue body).

## Task

- New package `packages/connector-github/`, implements `Connector` from
  `bridge-core`.
- `create_issue`/`update_issue`: Markdown body from `title`/`description`.
- `search`/`fetch` for the generic issue picker.
- Attachment handling: `/v1/attachments` supplies one file per request after
  issue mutation. The connector commits it to the configured branch and
  adds an issue comment with the file link unless that exact comment already
  exists; it returns a per-file
  `AttachmentResult`. A failed commit does not undo issue creation (task 07).
- Credential-validity check: `GET /user` (source plan, "Protocol v1
  scope").
- Capability manifest: `targets.issue` with actions `create`/`update`, reads
  `fetch`/`search` and `attachments` —
  not `transition_issue`/test-case targets (reserved, not implemented).

## Acceptance criteria

- [x] Create/update send the supplied Markdown description as the GitHub
      issue body. `packages/connector-github/src/index.ts` and its unit test
      cover the direct field mapping.
- [ ] Confirm body parity with the former extension `github-client.ts` using
      its fixtures or a real test repository.
- [x] Attachments use the GitHub Contents API on a configurable branch,
      defaulting to `fairlead-attachments`; a repeat upload replaces the
      file by SHA. The connector adds an issue comment with the file link
      unless the identical comment exists. Covered by the connector code and
      its unit test.
- [ ] Confirm attachment parity with the former extension behavior,
      including branch naming and link format. The current connector uses
      an issue comment and the Contents API `html_url`; the original plan
      describes a `/raw/` link, so parity is not established.
- [x] `checkCredential()` calls `GET /user`; the credential-gated GitHub
      connector suite checks this against the provider.
- [ ] Wire credential validation into the profile/project-selection flow.
      The capability manifest has no credential-check field and the Worker
      exposes no check route.
- [x] `bridge-core` conformance tests are registered against this
      connector's `execute()` in `packages/connector-github/src/index.test.ts`.
- [ ] Run the credential-gated GitHub connector and local CP + Worker E2E
      suites against a dedicated repository.
