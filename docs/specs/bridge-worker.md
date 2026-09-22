# bridge-worker contract

Current-state reference for the cloud-mode Worker adapter in
`packages/bridge-worker`. The public wire shapes are defined in
[`bridge-core-contract.md`](bridge-core-contract.md); deployment steps and
limits are in the [cloud deployment runbook](../runbooks/cloud-bridge-deployment.md).

## Identity and trusted routing

Every public route requires a Bearer Fairlead identity token. For command,
read, attachment, and credential-check operations, the Worker calls the
Control Plane `resolveBridgeCredential` Service Binding with that token,
`project_id`, and `integration_instance_id`. This single resolution call
validates the identity token and returns the caller's provider credential,
trusted connector configuration, and request timeout. The Worker does not
make a second token-verification call.

The Worker resolves the connector from Control Plane's `catalog_type` and
builds provider context from the returned configuration, including the
project or repository container. Caller-supplied connector identity, provider
host, credentials, and connector configuration are not authoritative. The
extension sends only the routing identifiers needed for resolution. For
`/v1/commands`, authentication and credential resolution happen before the
Worker decodes command fields. For `/v1/attachments`, it resolves credentials
from routing headers before consuming the multipart body.

An invalid identity token returns `401`; invalid routing or unsupported
connector/action errors use the normal Bridge error envelope. A failed or
unavailable Control Plane resolution does not dispatch to a connector.

## Runtime, connector dispatch, and deadlines

The Worker runs on Cloudflare Workers. It receives the Control Plane Service
Binding through its environment and passes the resolved credential/config
and an abort signal to connector factories; connector packages do not access
Worker bindings directly. The production catalog-to-connector registry is
in `src/index.ts`. The Worker calls connectors only through the `Connector`
interface; provider API behavior belongs to the connector packages. Before
executing a write, the Worker checks the resolved connector's protocol
version and declared target action. An undeclared action returns
`unsupported_action` (`422`). Reads, attachments, and credential checks
return typed unsupported-operation errors when the connector has not
declared or implemented the corresponding method.

Control Plane supplies `request_timeout_seconds`. The Worker accepts an
integer from 1 through 300 seconds and uses a 15-second default when the
value is absent or invalid. It passes an `AbortSignal` to connector work and
aborts provider requests at the deadline. A command timeout returns `504`
with an unknown outcome: the provider may have completed the mutation, so a
retry can create a duplicate. The timeout setting is returned as part of
credential resolution; registration and adjustment are documented in the
[deployment runbook](../runbooks/cloud-bridge-deployment.md).

## Cloud deployment behavior

Cloud mode uses the Control Plane Service Binding and does not enroll or send
heartbeats. The singleton cloud Bridge row must be registered in Control
Plane after deployment and before SaaS tracker instances are assigned. See
the deployment runbook for the registration request and environment setup.
