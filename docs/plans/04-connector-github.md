# 04 — connector-github

**Status:** in progress — connector attachment flow verified against the former client and real GitHub; Worker E2E and credential-check wiring remain open
**Depends on:** [01-stabilize-contract.md](01-stabilize-contract.md), [02-bridge-worker.md](02-bridge-worker.md)
**Related:** [06-retire-extension-direct-transport.md](06-retire-extension-direct-transport.md), [chrome-extension `docs/specs/issue-tracker-integration.md`](../../../chrome-extension/docs/specs/issue-tracker-integration.md)

## Why

GitHub is the other tracker the extension already talks to directly today
(`github-client.ts`) — same rationale as
[03-connector-jira.md](03-connector-jira.md): a port of working behavior,
not new design.

## Former extension behavior (from `github-client.ts` before cutover)

- Markdown description body, not ADF/Wiki Markup.
- Attachments have **no native binary-attachment API on GitHub Issues** —
  the former extension committed screenshots to a dedicated branch in the same
  repo (`ensureGithubAttachmentsBranch()` + `uploadAttachmentToGithub()`,
  branch name `Profile.github.attachmentsBranch`, default
  `fairlead-attachments`) via the Contents API, then linked with a `/raw/`
  URL. Its submit flow appended screenshots as Markdown images to the issue
  body. This is GitHub's actual "native attachment mechanism" for this
  connector, per the source plan's "Responsibility split" ("Bridge
  retrieves those files and attaches them using the connector's native
  attachment mechanism" — for GitHub that mechanism is the branch-commit
  path, not a literal upload endpoint, since none exists).
- The former submit flow edited the issue body after uploading files.
  The connector now does the same after each separate attachment request,
  preserving the current issue body and managing only its own section.

## Task

- New package `packages/connector-github/`, implements `Connector` from
  `bridge-core`.
- `create_issue`/`update_issue`: Markdown body from `title`/`description`.
- `search`/`fetch` for the generic issue picker.
- Attachment handling: `/v1/attachments` supplies one file per request after
  issue mutation. The connector commits it to the configured branch and
  adds or replaces a `/raw/` link in a managed section of the issue body.
  Images use Markdown image syntax so they render inline; other files use
  a normal link. The result is a per-file `AttachmentResult`. A failed
  commit or body update does not undo issue creation (task 07).
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
      file by SHA. The connector adds or replaces its link in the issue body
      while preserving the remaining text. Covered by the connector unit test.
- [x] Attachment branch default, Contents API replacement by SHA, `/raw/`
      link and inline image Markdown match the former extension's attachment
      behavior. Verified against the former `github-client.ts` and
      `github-client.integration.test.ts` in the extension's pre-cutover
      revision (`1d39916^`), and by connector unit tests. The connector
      updates the issue body after each separate attachment request.
- [x] `checkCredential()` calls `GET /user`; the credential-gated GitHub
      connector suite checks this against the provider.
- [ ] Wire credential validation into the profile/project-selection flow.
      The capability manifest has no credential-check field and the Worker
      exposes no check route.
- [x] `bridge-core` conformance tests are registered against this
      connector's `execute()` in `packages/connector-github/src/index.test.ts`.
- [x] The revised credential-gated GitHub connector E2E passed against a
      dedicated repository (2026-09-23): create/update, reads, attachment
      replacement, `/raw/` links and inline screenshot Markdown in the issue
      body, plus credential checks.
- [ ] Run the local CP + Worker + GitHub E2E suite against a dedicated
      repository.
