# Local Bridge + Control Plane + real GitHub E2E

This suite starts a local Control Plane and a local cloud-mode Bridge Worker.
The Bridge reaches the CP through the real `CONTROL_PLANE` Service Binding and
creates an issue in a dedicated GitHub repository.

Set these variables before running it:

```text
BRIDGE_E2E_GITHUB_TOKEN=<fine-grained PAT with Issues read/write access>
BRIDGE_E2E_GITHUB_OWNER=<GitHub owner>
BRIDGE_E2E_GITHUB_REPO=<dedicated test repository>
```

The Control Plane checkout is expected at `../control-plane`. Override it with
`CP_REPO_PATH` if necessary. The local D1 is reset before each run. The test
closes the issue it creates during cleanup.

Run:

```bash
npm run test:e2e:github
```

The suite is skipped when the three GitHub variables are absent, so it is safe
to run the normal test command without provider credentials.
