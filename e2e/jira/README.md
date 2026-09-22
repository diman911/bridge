# Real Jira Cloud connector E2E

The suite creates a Jira Cloud Bug in a dedicated project, updates and reads
it, uploads and replaces a native attachment, checks credentials, and deletes
the issue during cleanup.

Set these variables in `.env.e2e`:

```text
BRIDGE_E2E_JIRA_BASE_URL=https://your-site.atlassian.net
BRIDGE_E2E_JIRA_EMAIL=you@example.com
BRIDGE_E2E_JIRA_TOKEN=<Jira Cloud API token>
BRIDGE_E2E_JIRA_PROJECT_KEY=<dedicated test project>
```

Run it with:

```bash
npm run test:e2e:jira:connector
```

The suite is skipped when any Jira variable is absent.

## Optional OAuth 2.0 suite

To exercise the Atlassian API Gateway path, set `BRIDGE_E2E_JIRA_OAUTH_TOKEN`,
`BRIDGE_E2E_JIRA_OAUTH_CLOUD_ID`, and the same `BRIDGE_E2E_JIRA_PROJECT_KEY`.
It is skipped when those values are absent. Run it with:

```bash
npm run test:e2e:jira:oauth
```
