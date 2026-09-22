import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectorAttachment, ReadOperation } from '@fairlead/bridge-core';
import { JiraConnector } from '../../packages/connector-jira/src/index.js';

const token = process.env.BRIDGE_E2E_JIRA_OAUTH_TOKEN;
const cloudId = process.env.BRIDGE_E2E_JIRA_OAUTH_CLOUD_ID;
const projectKey = process.env.BRIDGE_E2E_JIRA_PROJECT_KEY;
const enabled = Boolean(token && cloudId && projectKey);
const gateway = cloudId
  ? `https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}`
  : '';

const suite = describe.skipIf(!enabled);

suite('Jira connector → real Jira Cloud OAuth API gateway', () => {
  let connector: JiraConnector;
  let issueKey: string | undefined;

  beforeAll(async () => {
    connector = new JiraConnector({
      // OAuth requests deliberately ignore this direct-tenant URL.
      baseUrl: 'https://not-used.atlassian.net',
      cloudId: cloudId!,
      projectKey: projectKey!,
      token: token!,
      authType: 'oauth',
    });
    const created = await connector.execute(
      {
        protocolVersion: 1,
        type: 'create_issue',
        subject: `Fairlead OAuth E2E ${crypto.randomUUID()}`,
        description: 'Created through the Atlassian OAuth API gateway.',
      },
      { signal: new AbortController().signal },
    );
    expect(created).toMatchObject({ ok: true });
    issueKey = created.issueId;
  }, 30_000);

  afterAll(async () => {
    if (!issueKey) return;
    await fetch(`${gateway}/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }, 30_000);

  it('checks credentials, updates, reads, searches, and uploads through OAuth', async () => {
    const signal = new AbortController().signal;
    await expect(connector.checkCredential(signal)).resolves.toBe(true);
    await expect(
      connector.execute(
        {
          protocolVersion: 1,
          type: 'update_issue',
          issueId: issueKey!,
          subject: 'Fairlead OAuth E2E updated',
          description: 'Updated through the Atlassian OAuth API gateway.',
        },
        { signal },
      ),
    ).resolves.toMatchObject({ ok: true, issueId: issueKey });
    await expect(
      connector.read!({ type: 'fetch', connectorId: 'jira', id: issueKey! } satisfies ReadOperation, {
        signal,
      }),
    ).resolves.toMatchObject({ ok: true, issue: { id: issueKey } });
    await expect(
      connector.read!(
        { type: 'search', connectorId: 'jira', query: 'Fairlead OAuth E2E' } satisfies ReadOperation,
        { signal },
      ),
    ).resolves.toMatchObject({ ok: true });
    const attachment: ConnectorAttachment = {
      protocolVersion: 1,
      issueId: issueKey!,
      filename: `oauth-evidence-${crypto.randomUUID()}.txt`,
      contentType: 'text/plain',
      data: new Blob(['OAuth attachment']).stream(),
      limitState: { exceeded: false, actualBytes: 16 },
    };
    await expect(connector.attach!(attachment, { signal })).resolves.toEqual({
      filename: attachment.filename,
      ok: true,
    });
  }, 30_000);
});
