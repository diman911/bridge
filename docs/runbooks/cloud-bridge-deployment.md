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
