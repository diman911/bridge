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
Current-state orientation: [`AGENTS.md`](AGENTS.md). Active work:
[`docs/plans/`](docs/plans/README.md).

## Status

Cloud-mode Bridge and three issue-tracker connectors are implemented. Current
validation and extension cutover work is listed in [`docs/plans/`](docs/plans/README.md).

## Getting started

```bash
npm install
npm run build
npm test
```

## Cloud deployment

Cloudflare Workers Builds deploys `develop` to the dev Worker automatically.
Pushes to `main` upload a production version, which a platform operator then
promotes manually in the Cloudflare dashboard. See
[`docs/ci-cd.md`](docs/ci-cd.md) and the
[`cloud Bridge deployment runbook`](docs/runbooks/cloud-bridge-deployment.md).

## Project structure

```text
packages/
  bridge-core/       command validation, routing, policy, Connector interface (implemented)
  bridge-worker/      Cloudflare Workers adapter for cloud-mode Bridge
  bridge-runner/      Node.js CLI/daemon adapter for private-mode Bridge (not yet built)
  connector-jira/       Jira Cloud connector
  connector-github/     GitHub Issues connector
  connector-azure-devops/ Azure DevOps Services connector
docs/
  architecture/        system map and durable decisions
  specs/               current-state contracts
  plans/                active implementation and validation work
  processes/            maintenance conventions
```
