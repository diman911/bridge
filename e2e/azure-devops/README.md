# Real Azure DevOps Services connector E2E

The suite creates a `Bug` in a dedicated Azure DevOps Services project, updates
and reads it, replaces a native attachment, verifies the PAT, then deletes the
work item during cleanup.

Set these variables in `.env.e2e`:

```text
BRIDGE_E2E_AZURE_DEVOPS_ORGANIZATION=your-organization
BRIDGE_E2E_AZURE_DEVOPS_PROJECT=Dedicated test project
BRIDGE_E2E_AZURE_DEVOPS_PAT=<PAT with Work Items read/write access>
BRIDGE_E2E_AZURE_DEVOPS_OAUTH_TOKEN=<Entra ID-issued OAuth access token>
```

Run the PAT suite with:

```bash
npm run test:e2e:azure-devops:pat
```

Run the OAuth suite with:

```bash
npm run test:e2e:azure-devops:oauth
```

Each suite is skipped when its token or the shared organization/project values
are absent. Both credentials need Work Items read/write access. The OAuth suite
tests the connector's Bearer path directly; automatic OAuth connection and
refresh in Control Plane remain separate work.
