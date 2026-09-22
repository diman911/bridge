# AGENTS.md — Fairlead Bridge

Entrypoint for AI coding tools working on this repo. Gives current-state
orientation only — for anything deeper, follow the pointers in **Where to
look next** rather than duplicating detail here.

## What this project is

Translates a provider-neutral integration command (create/update/transition
an issue, write back a test result, attach evidence, or share-only) into
calls against a specific issue tracker or test-management (TM) system — and,
via the same connector model, normalizes read-only log queries against a
customer's own log backend (Log Source capability).

This is the `bridge` service (formerly called "Gateway" during early design
— renamed 2026-09-16 so the whole service, in either deployment mode, has
one name, the same way Data Plane has no separate name per mode) referenced
throughout
[`../chrome-extension/docs/plans/integration-connector-gateway.md`](../chrome-extension/docs/plans/integration-connector-gateway.md).
That document is the authoritative design for the whole Bridge concept
(transports, responsibility boundaries, generic command contract, delivery
phases) — this file only orients an agent already working inside _this_
repo. Read the linked plan before making a structural decision here.

Bridge runs in two modes, `cloud` and `private` — exactly like Data Plane's
`DpMode`, not two differently-named components. `cloud` is one shared
platform-wide instance serving every organization's SaaS trackers; `private`
is a customer-deployed instance serving exactly one organization from inside
that customer's own network/VPN.

## Status

Repository scaffold only. `packages/bridge-core` holds a first draft of the
command/connector contract (envelope v1, `ConnectorCommand`, `Connector`,
`ConnectorCapabilities`). None of `bridge-worker`, `bridge-runner`,
`connector-jira`, `connector-github`, or any Log Source connector exist yet
— see the "Portable implementation shape" section of the linked plan for
the target package tree, and
[`docs/plans/`](docs/plans/README.md) for active implementation work.

## Role in the ecosystem

Sibling repositories under `../` (same parent directory):

| Repo                  | Role                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `../chrome-extension` | Chrome extension (Fairlead Recorder) — owns capture, user verdict, evidence selection, and the `direct` transport (no-auth built-in Jira/GitHub) |
| `../control-plane`    | Auth, org/project config, token issuance — will own Bridge enrollment, routing (`bridge_id`), and policy                                         |
| `../data-plane`       | Sanitized evidence storage — this repo references evidence by URL, never stores or copies it                                                     |
| `../ticket-enricher`  | AI bug-description generation from a recorded session — unrelated concern (enrichment, not filing); do not conflate with this repo               |

This repo must not become a second source of session truth, and must not
store raw captures or copies of tracker issues — see the linked plan's
"Responsibility boundaries" table.

## Tech stack (target)

- TypeScript (strict mode, ES2022 target), npm workspaces monorepo
- `packages/bridge-core`: portable Web APIs only (`fetch`, `Request`,
  `Response`) — no Workers bindings, no Node `fs`
- `packages/bridge-worker` (not yet built): Cloudflare Worker adapter for
  `cloud`-mode Bridge
- `packages/bridge-runner` (not yet built): Node.js CLI/daemon adapter for
  `private`-mode Bridge (customer-network deployment). "Runner" here is a
  generic implementation-adapter label, parallel to "worker" for the
  Cloudflare adapter — not a reintroduction of the old "Runner" product
  name from an earlier design draft (that concept is now just "Bridge in
  `private` mode").
- Vitest for tests

## Module map

| Path                    | Responsibility                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/bridge-core/` | Command/result types, `Connector` interface, (future) validation and routing — the only package with real code today |

## Where to look next

- **[`../chrome-extension/docs/plans/integration-connector-gateway.md`](../chrome-extension/docs/plans/integration-connector-gateway.md)**
  — the full design: transports, contract, routing, Bridge (`cloud`/`private`
  modes), Log Source connectors, delivery phases, open questions.
- **[`docs/plans/`](docs/plans/README.md)** — active implementation plans
  for this repo.
- **`docs/architecture/overview.md`** — this repo's own architecture map
  (thin; defers to the linked plan for anything not yet decided).
- **`docs/processes/ai-workflow.md`** — how to work in this repo: where new
  ideas/tech-debt/bugs go, spec vs. plan vs. ADR conventions, definition of
  done.
