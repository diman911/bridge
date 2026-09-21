# 05 — connector-azure-devops

**Status:** not started
**Depends on:** [01-stabilize-contract.md](01-stabilize-contract.md), [02-bridge-worker.md](02-bridge-worker.md), `control-plane` task 17 (Azure DevOps catalog entry + connect flow — see `control-plane/docs/plans/17-azure-devops-catalog-and-connect-flow.md`)
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
  `System.Description` (or `Microsoft.VSTS.TCM.ReproSteps`, depending on
  the work item type's field layout for `Bug` — confirm against the
  target process template during implementation, since this varies between
  Agile/Scrum/CMMI templates).

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
  `AttachedFile` relation) — use it, not a workaround. Report per-file
  results into `IntegrationResult.attachments`.
- Credential-validity check: `GET
  https://app.vssps.visualstudio.com/_apis/profile/profiles/me` — the
  standard Azure DevOps "who am I" call, works for both OAuth and PAT.
- OAuth flow specifics (Entra ID app registration, redirect URI, API
  permission/scope) are a `control-plane` concern (task 17) — this
  connector consumes a resolved bearer credential from Bridge, it does
  not perform the OAuth
  dance itself.
- Capability manifest: `supportedTargets: ['issue']`,
  `supportedActions: ['create_issue', 'update_issue']` plus search/fetch.

## Open implementation question

Whether `description` maps to `System.Description` or
`Microsoft.VSTS.TCM.ReproSteps` (or both) for a `Bug` work item depends on
the org's process template (Agile/Scrum/Basic/CMMI each lay these out
differently). Decide during implementation against a real Azure DevOps
Services test org — not assumable from the API docs alone.

## Acceptance criteria

- [ ] Create/update produce a valid `Bug` work item against a real Azure
      DevOps Services test organization, with no Area/Iteration Path set,
      relying on the org's process-template defaults.
- [ ] A project whose process template requires Area/Iteration Path with
      no default surfaces that as a clear error in `IntegrationResult`,
      not a silent failure or a thrown exception.
- [ ] Native attachment upload works and reports per-file results.
- [ ] Credential-validity check works against both an OAuth-issued token
      and a pasted PAT.
- [ ] Conformance tests from `bridge-core` (task 01) pass against this
      connector's `execute()`.
