# 04 — connector-github

**Status:** not started
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
- Attachment handling: branch-commit-and-link path above, run from
  `bridge-worker` instead of the extension. Report per-file results into
  `IntegrationResult.attachments` — a failed commit for one file must not
  fail an otherwise-successful issue creation.
- Credential-validity check: `GET /user` (source plan, "Protocol v1
  scope").
- Capability manifest: `targets.issue` with actions `create`/`update`, reads
  `fetch`/`search` and `attachments` —
  not `transition_issue`/test-case targets (reserved, not implemented).

## Acceptance criteria

- [ ] Create/update produce the same Markdown body shape
      `github-client.ts` produces today.
- [ ] Attachment branch-commit-and-link behavior matches today's
      extension-side behavior (same branch-name default, same linking
      convention), verified against
      `github-client.integration.test.ts`'s existing fixtures/behavior.
- [ ] `GET /user` credential check implemented and wired to the capability
      manifest.
- [ ] Conformance tests from `bridge-core` (task 01) pass against this
      connector's `execute()`.
