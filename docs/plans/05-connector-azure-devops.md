# 05 — connector-azure-devops

**Status:** in progress — implementation and local tests exist; live Azure DevOps validation remains open
**Depends on:** [bridge-core contract](../specs/bridge-core-contract.md), [bridge-worker contract](../specs/bridge-worker.md), `control-plane` task 17 (Azure DevOps catalog entry + connect flow — see `control-plane/docs/plans/17-azure-devops-catalog-and-connect-flow.md`)
**Related:** [chrome-extension plan — "Protocol v1 scope"](../../../chrome-extension/docs/plans/integration-connector-gateway.md)

## Why

Third tracker for the first stage (decided 2026-09-21) — unlike Jira/
GitHub, there is no existing extension-side implementation to port. This
is new design work within the constraints already decided in the source
plan.

## Scope boundary

**Azure DevOps Services only** (SaaS, `dev.azure.com`). Azure DevOps
Server (on-prem) is out of scope for this stage — it would need
`private`-mode Bridge (Phase 3, not yet built), not this connector.

## Decided constraints (source plan, "Protocol v1 scope")

- **Credentials:** both OAuth and a pasted PAT, resolved per-user via
  Control Plane the same way as Jira/GitHub — not a shared org credential.
  **The OAuth flow is Microsoft Entra ID app registration** — confirmed
  2026-09-22 (an intermediate correction that day, saying it was the
  classic Azure DevOps OAuth app instead, was itself wrong: that flow is
  retired by Microsoft, screenshot-confirmed). See `control-plane` task 17
  for the registration/exchange mechanics. This connector receives a
  resolved bearer token from Bridge either way; the distinction only
  matters for where the token came from, not how this connector uses it —
  the token is presented as a normal Bearer credential against
  `dev.azure.com`/`vssps.visualstudio.com` regardless.
- **Required fields:** `System.WorkItemType` fixed to `Bug`;
  `System.AreaPath`/`System.IterationPath` are **not** set by this
  connector — rely on the target project's process-template defaults. A
  project with no default on a field its template requires will surface
  Azure DevOps's own validation error back through the command result;
  this connector does not attempt to guess or backfill a value.
- **Standard fields only:** `title` → `System.Title`, `description` →
  `System.Description`. The code chooses this field; confirm that it is
  suitable for the target process template in a real test organization.

## Task

- New package `packages/connector-azure-devops/`, implements `Connector`
  from `bridge-core`.
- `create_issue` → `POST
https://dev.azure.com/{organization}/{project}/_apis/wit/workitems/$Bug`
  (JSON Patch body per the Azure DevOps Work Items REST API).
  `update_issue` → `PATCH` the same work item.
- `search`/`fetch` via the Work Item Query Language (WIQL) endpoint and
  `GET .../_apis/wit/workitems/{id}` respectively.
- Attachment handling: Azure DevOps has a native attachment API
  (`POST .../_apis/wit/attachments`, then link via a JSON Patch
  `AttachedFile` relation) — use it, not a workaround. Return a per-file
  `AttachmentResult` from the separate `/v1/attachments` request (task 07).
- Credential-validity check: `GET
https://dev.azure.com/{organization}/_apis/projects?$top=1` with
  `redirect: 'manual'`, requiring a `200` JSON response. This validates the
  minimum Project-and-Team-read access the connector needs; the profile API
  requires an additional Profile scope for PATs and can return a sign-in HTML
  page for an invalid credential.
- OAuth flow specifics (Entra ID app registration, redirect URI, API
  permission/scope) are a `control-plane` concern (task 17) — this
  connector consumes a resolved bearer credential from Bridge, it does
  not perform the OAuth
  dance itself.
- Capability manifest: `targets.issue` with actions `create`/`update`, reads
  `fetch`/`search` and `attachments`.

## Open validation question

The implementation maps `description` to `System.Description`. Confirm
against a real Azure DevOps Services test organization whether this field
meets the `Bug` layout of its process template, or whether
`Microsoft.VSTS.TCM.ReproSteps` is also needed.

## Acceptance criteria

- [x] Create/update use the `Bug` Work Items endpoint and patch
      `System.Title` and `System.Description` without setting
      Area/Iteration Path. Covered by
      `packages/connector-azure-devops/src/index.test.ts`.
- [ ] Confirm create/update against a real Azure DevOps Services test
      organization with its process-template defaults and validate the
      chosen description field.
- [ ] A project whose process template requires Area/Iteration Path with
      no default surfaces that as a clear error in `IntegrationResult`,
      not a silent failure or a thrown exception.
- [x] Native attachment upload calls the Azure DevOps attachment endpoint,
      adds an `AttachedFile` relation and returns a per-file result. The
      replacement path is covered by the connector unit test.
- [ ] Confirm native attachment upload and replacement against a real
      Azure DevOps Services test organization.
- [x] `checkCredential()` requests the project list with
      `redirect: 'manual'` and accepts only a `200` JSON response. Unit tests cover
      valid, invalid and redirected responses and PAT/OAuth auth headers.
- [ ] Confirm credential checks with a real Entra ID OAuth token and a
      pasted PAT. Both E2E suites require provider credentials and skip
      when those are absent.
- [x] `bridge-core` conformance tests are registered against this
      connector's `execute()` in
      `packages/connector-azure-devops/src/index.test.ts`.
