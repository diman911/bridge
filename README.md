# Fairlead Bridge

Translates a provider-neutral integration command into calls against a
specific issue tracker or test-management system (Jira, GitHub, and future
connectors), and normalizes read-only queries against a customer's own log
backend for the Log Source capability. Runs in two modes — `cloud` (one
shared, platform-wide Cloudflare Worker instance) and `private` (a
customer-deployed Node.js process reachable only from inside that
customer's own network) — the same `cloud`/`private` split Data Plane
already uses, not two differently-named services.

Full design: [`../chrome-extension/docs/plans/integration-connector-gateway.md`](../chrome-extension/docs/plans/integration-connector-gateway.md).
Current-state orientation: [`AGENTS.md`](AGENTS.md). Work plan:
[`docs/plans/00-bootstrap.md`](docs/plans/00-bootstrap.md).

## Status

Early scaffold — see [`AGENTS.md`](AGENTS.md#status).

## Getting started

```bash
npm install
npm run build
npm test
```

## Project structure

```text
packages/
  bridge-core/       command validation, routing, policy, Connector interface (implemented)
  bridge-worker/      Cloudflare Workers adapter for cloud-mode Bridge (not yet built)
  bridge-runner/      Node.js CLI/daemon adapter for private-mode Bridge (not yet built)
  connector-jira/       (not yet built)
  connector-github/     (not yet built)
docs/
  architecture/        system map and durable decisions
  specs/               current-state contracts (empty until Phase 1 ships)
  plans/                proposed, unshipped work
  processes/            maintenance conventions
```
