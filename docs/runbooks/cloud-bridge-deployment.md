# Cloud Bridge deployment

## Environments

The cloud-mode Worker has two Wrangler environments:

| Environment  | Worker name           | Public hostname                     | Control Plane Service Binding |
| ------------ | --------------------- | ----------------------------------- | ----------------------------- |
| `dev`        | `fairlead-bridge-dev` | `https://dev.bridge.fairleadhq.com` | `control-plane-dev`           |
| `production` | `fairlead-bridge`     | `https://bridge.fairleadhq.com`     | `control-plane`               |

The commands below use the same script that Cloudflare Workers Builds runs.
`dev` deploys immediately; `production` uploads a version only and requires a
manual promotion in the Cloudflare dashboard.

For manual use:

```bash
npm run deploy:dev --workspace @fairlead/bridge-worker
npm run deploy:production --workspace @fairlead/bridge-worker
```

Configure Cloudflare Workers Builds with these branch-to-command mappings:

| Branch    | Environment  | Deploy command                          |
| --------- | ------------ | --------------------------------------- |
| `develop` | `dev`        | `node scripts/deploy-ci.mjs dev`        |
| `main`    | `production` | `node scripts/deploy-ci.mjs production` |

GitHub Actions validates these commands but does not hold Cloudflare
credentials or deploy. Full lifecycle details are in
[`docs/ci-cd.md`](../ci-cd.md).

Deploy the matching Control Plane environment first so the `CpRpc` Service
Binding target exists. Validate a configuration without deploying with:

```bash
node scripts/deploy-ci.mjs dev --dry-run
node scripts/deploy-ci.mjs production --dry-run
```

The two environments use separate Control Plane workers and separate D1
databases. Do not point the production Bridge binding at `control-plane-dev`.

After deploying `bridge-worker` to its final HTTPS URL, a platform administrator must register the singleton cloud Bridge in Control Plane. Deployment does not create this row.

```http
POST /internal/platform/bridges
Authorization: Bearer <platform-admin-token>
Content-Type: application/json

{
  "name": "Fairlead Cloud Bridge",
  "url": "https://bridge.example.com",
  "mode": "cloud"
}
```

Do this once, before assigning SaaS tracker instances. Control Plane returns
the registered `request_timeout_seconds` to the Worker through the Service
Binding on every command resolution. The default command timeout is 15
seconds; set `request_timeout_seconds` on registration, or use `PATCH
/internal/platform/bridges/{id}/timeout` to change it.

Cloud-mode command handling uses the Control Plane Service Binding. It does not register or send heartbeats.

The public API accepts `POST /v1/commands`, `POST /v1/reads`,
`POST /v1/attachments`, and `POST /v1/credentials/check`, all with a Bearer
identity token. The `protocolVersion` in JSON bodies (or in the attachment
`meta` part) must be `1`.
Attachment requests also require `X-Fairlead-Project-Id` and
`X-Fairlead-Integration-Instance-Id`; Bridge resolves these before reading the
multipart body.

Request limits, all enforced while the body is read incrementally:

- JSON commands and reads: 256 KiB (`MAX_JSON_REQUEST_BYTES`), otherwise `413`.
- Attachment `meta` part: 16 KiB.
- Attachment file: 5 MiB (`MAX_ATTACHMENT_BYTES`), otherwise
  `413 attachment_too_large`. This is an interim value for every provider; raising
  it requires measuring Worker memory/CPU per provider, GitHub first because it
  buffers the file and base64-encodes it.
