# Architecture overview

This file is deliberately thin. The authoritative design — transports,
responsibility boundaries, generic command contract, routing, Bridge,
Log Source connectors, and delivery phases — lives in
[`../../../chrome-extension/docs/plans/integration-connector-gateway.md`](../../../chrome-extension/docs/plans/integration-connector-gateway.md).
This file exists to hold whatever becomes _this repo's own_ current-state
truth as pieces of that plan ship, per the split described in
[`../processes/ai-workflow.md`](../processes/ai-workflow.md) (`docs/plans/`
is a working log; `docs/architecture/` and `docs/specs/` are reference).

## Transport diagram (from the linked plan)

```mermaid
flowchart LR
  E[Chrome Extension] -->|direct, personal/no-auth| T[Tracker or TM API]
  E -->|integration command| CP[Control Plane]
  CP --> CG[Bridge (cloud)]
  CP --> RG[Bridge (private)]
  CG --> T
  RG --> IT[Internal Tracker or TM API]
  E -->|upload / evidence reference| DP[Data Plane]
```

`bridge-worker` (Cloudflare Worker) implements the `CG` node above
(`cloud`-mode Bridge); `bridge-runner` (Node.js) implements `RG`
(`private`-mode Bridge). Neither exists yet — see
[`../plans/00-bootstrap.md`](../plans/00-bootstrap.md).

## Current-state package map

| Package                     | Runtime                                      | Status                                                                                                 |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/bridge-core`      | Portable (`fetch`/`Request`/`Response` only) | First draft: `IntegrationCommand`, `Connector`, `ConnectorCapabilities` (`packages/bridge-core/src/`) |
| `packages/bridge-worker`    | Cloudflare Workers                           | Not started                                                                                            |
| `packages/bridge-runner`    | Node.js                                      | Not started                                                                                            |
| `packages/connector-jira`   | —                                            | Not started                                                                                            |
| `packages/connector-github` | —                                            | Not started                                                                                            |

## Cross-repo dependencies

| Depends on            | For                                                                                                                                                                                                                                                        | Status                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `../control-plane`    | `bridge_id` assignment, org/project routing, connector configuration, authorization                                                                                                                                                                       | Not yet implemented on the CP side — CP's current README does not describe a Bridge/connector routing layer |
| `../chrome-extension` | Consumer of `@fairlead/bridge-core`'s command types; today `submit.ts` branches on `profile.bugTracker` directly against `jira-client.ts`/`github-client.ts` with no shared interface (see `../chrome-extension/docs/specs/issue-tracker-integration.md`) | Refactor not started — see open decision in `../plans/00-bootstrap.md`                                       |
| `../data-plane`       | Evidence referenced by URL in `EvidenceReference`                                                                                                                                                                                                          | No direct coupling; this repo never stores evidence                                                          |
