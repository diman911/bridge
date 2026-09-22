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
(`private`-mode Bridge). See [`../plans/`](../plans/README.md) for current
implementation status and remaining work.

## Current-state package map

| Package                     | Runtime                                      | Status                                                                                                                      |
| --------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/bridge-core`      | Portable (`fetch`/`Request`/`Response` only) | Envelope v1, `ConnectorCommand`, `Connector`, `ConnectorCapabilities`, description formatters (`packages/bridge-core/src/`) |
| `packages/bridge-worker`    | Cloudflare Workers                           | Not started                                                                                                                 |
| `packages/bridge-runner`    | Node.js                                      | Not started                                                                                                                 |
| `packages/connector-jira`   | —                                            | Not started                                                                                                                 |
| `packages/connector-github` | Cloudflare Workers                           | GitHub Issues connector: Markdown issues, reads, Contents API attachments, and `/user` credential validation              |

## Cross-repo dependencies

| Depends on            | For                                                                                                                                                                                                                                                       | Status                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `../control-plane`    | `bridge_id` assignment, org/project routing, connector configuration, authorization                                                                                                                                                                       | Not yet implemented on the CP side — CP's current README does not describe a Bridge/connector routing layer |
| `../chrome-extension` | Consumer of the Bridge wire contract; contract types are vendored from `packages/bridge-core` | Bridge cutover tracked in [`../plans/06-retire-extension-direct-transport.md`](../plans/06-retire-extension-direct-transport.md) |
| `../data-plane`       | Evidence referenced by URL in `EvidenceReference`                                                                                                                                                                                                         | No direct coupling; this repo never stores evidence                                                         |
