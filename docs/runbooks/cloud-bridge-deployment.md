# Cloud Bridge deployment

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

Do this once, before assigning SaaS tracker instances. The default command timeout is 15 seconds; set `request_timeout_seconds` on registration, or use `PATCH /internal/platform/bridges/{id}/timeout` to change it.

Cloud-mode command handling uses the Control Plane Service Binding. It does not register or send heartbeats.

The public API accepts only `POST /v1/commands`, `POST /v1/reads` and
`POST /v1/attachments` with a Bearer identity token. The `protocolVersion` in the
body (or in the attachment `meta` part) must be `1`.

Request limits, all enforced while the body is read incrementally:

- JSON commands and reads: 256 KiB (`MAX_JSON_REQUEST_BYTES`), otherwise `413`.
- Attachment `meta` part: 16 KiB.
- Attachment file: 5 MiB (`MAX_ATTACHMENT_BYTES`), otherwise
  `413 attachment_too_large`. This is an interim value for every provider; raising
  it requires measuring Worker memory/CPU per provider, GitHub first because it
  buffers the file and base64-encodes it.
