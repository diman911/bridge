# 02 — bridge-worker: cloud-mode Bridge

**Status:** in progress
**Depends on:** [01-stabilize-contract.md](01-stabilize-contract.md)
**Amended by:** [07-report-envelope-and-versioning.md](07-report-envelope-and-versioning.md) — the worker exposes `POST /v1/commands`, `POST /v1/attachments` and `POST /v1/reads`, decodes versioned commands into an internal model, derives connector id, project context and caller from Control Plane and the verified token, and drops the `command.connectorId` cross-check. Apply on top of the task below.
**Related:** [00-bootstrap.md](00-bootstrap.md), [chrome-extension plan — "Bridge", "Routing and configuration"](../../../chrome-extension/docs/plans/integration-connector-gateway.md), `control-plane` tasks [06](../../../control-plane/docs/plans/06-bridge-tables.md), [09](../../../control-plane/docs/plans/09-bridge-credential-resolution-endpoint.md)

## Why

The one platform-wide `cloud`-mode Bridge instance every organization's
SaaS tracker routes through (source plan, "Routing and configuration" —
"Bridge cardinality"). The package now exists (`packages/bridge-worker`, serving `/v1/commands`,
`/v1/reads` and `/v1/attachments`); this plan was written when only `bridge-core`
was scaffolded. Current behaviour is in
[`../specs/bridge-core-contract.md`](../specs/bridge-core-contract.md).

## Task

- New package `packages/bridge-worker/`, Cloudflare Worker adapter per the
  source plan's "Portable implementation shape" — consumes `bridge-core`,
  must not itself depend on Node `fs`; Workers bindings (KV/D1/secrets) are
  injected through `bridge-core`'s interfaces, not hardwired into the
  connector packages.
- Resolve the caller's provider credential (OAuth/PAT) and the target
  connector's config (host/port for a SaaS entry is fixed; catalog-type
  lookup) from Control Plane in one round trip, keyed by `project_id` +
  `integration_instance_id` — `CpRpc.resolveBridgeCredential`
  (`control-plane/src/rpc.ts`), a Service Binding call. **Confirmed by
  `control-plane` task 16's audit: this single call already verifies the
  token's global signature internally** (`resolveBridgeCredentialCore`
  calls `validateTokenCore` before resolving anything) — no separate
  token-verification round trip is needed for any command that has a real
  tracker target, which is every command this stage implements. Never
  trust connector host/port supplied by the extension itself.
- **Exception to note, not solve now:** a future `share_only`/`target:
none` command (source plan, "Generic integration contract") touches no
  connector credential, so it wouldn't naturally go through
  `resolveBridgeCredential` at all. Decide then whether it needs a
  standalone `CpRpc.validateToken` call — out of scope for this stage's
  three connectors, all of which target `issue`.
- Request timeout: 15s default, configurable per Bridge (source plan,
  "Execution model: synchronous") — read from Control Plane routing/config
  data, not hardcoded. One deadline covers the whole request; there is no
  separate attachment deadline because attachments are their own request.
- `/v1/attachments` reads `project_id` and `integration_instance_id` from
  routing headers, resolves the credential before reading the multipart body,
  then reads its bounded `meta` part (see 08, B12).
- Dispatch to the resolved connector (`connector-jira`, `connector-github`,
  `connector-azure-devops`) via the `Connector` interface from
  `bridge-core`. `bridge-worker` itself contains no provider-specific logic.
- `wrangler dev --local` for local development, per the source plan.
- Health/enrollment reporting to Control Plane is **not** in scope here for
  `cloud` mode — there's exactly one platform-wide instance, not an
  admin-enrolled one; enrollment/health polling is a `private`-mode
  (`bridge-runner`) concern, Phase 3.
- **Deployment bootstrap step — found by `control-plane` task 16's audit,
  not automatic:** `getSingletonCloudBridge` (`control-plane/src/db/bridges.ts`)
  looks up the one `bridges` row with `mode = 'cloud'` — nothing creates
  this row on its own. Once `bridge-worker` is deployed and has a real URL,
  a platform admin must call `POST /internal/platform/bridges` (existing
  endpoint, `mode: 'cloud'`, per `control-plane` task 10) once, by hand, to
  register it — before that, every command resolving a SaaS tracker
  instance's Bridge fails to find one. Document this as a deploy-runbook
  step, don't assume it happens automatically.

## Acceptance criteria

- [x] `bridge-worker` rejects an invalid/expired token before dispatching
      to any connector — via `resolveBridgeCredential`'s built-in
      verification, one round trip, not a separate check. Covered by the
      local CP + Worker E2E suite through the real `CONTROL_PLANE` Service
      Binding for both malformed and cryptographically signed expired tokens.
- [x] A command's credential + config resolution is that same one round
      trip to Control Plane, keyed by `project_id` + `integration_instance_id`.
      Covered by the local CP + Worker E2E command flow through the real
      `CONTROL_PLANE` Service Binding.
- [x] Request timeout is read from routing/config data, defaults to 15s. CP
      returns the singleton cloud Bridge's `request_timeout_seconds`; Worker
      validates it and falls back to 15 seconds when absent or invalid.
- [x] Connector dispatch goes through `bridge-core`'s `Connector` interface
      only — no provider-specific branching in `bridge-worker` itself.
      Production connectors are registered as `ConnectorFactory` instances and
      the Worker dispatches through the shared interface.
- [ ] `wrangler dev --local` runs the worker locally against a stubbed
      Control Plane.
- [x] A deploy runbook note exists covering the one-time
      `POST /internal/platform/bridges` (`mode: 'cloud'`) registration
      step — not left as tribal knowledge. See
      `docs/runbooks/cloud-bridge-deployment.md`.
