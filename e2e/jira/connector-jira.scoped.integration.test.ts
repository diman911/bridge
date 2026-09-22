import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectorAttachment, ReadOperation } from '@fairlead/bridge-core';
import { JiraConnector } from '../../packages/connector-jira/src/index.js';

const baseUrl = process.env.BRIDGE_E2E_JIRA_BASE_URL;
const email = process.env.BRIDGE_E2E_JIRA_EMAIL;
const token = process.env.BRIDGE_E2E_JIRA_SCOPED_TOKEN;
const cloudId = process.env.BRIDGE_E2E_JIRA_SCOPED_CLOUD_ID;
const projectKey = process.env.BRIDGE_E2E_JIRA_PROJECT_KEY;
const enabled = Boolean(baseUrl && email && token && cloudId && projectKey);

const suite = describe.skipIf(!enabled);

suite('Jira connector → real Jira Cloud scoped API token gateway', () => {
  let connector: JiraConnector;
  let issueKey: string | undefined;

  beforeAll(async () => {
    connector = new JiraConnector({
      baseUrl: baseUrl!,
      cloudId: cloudId!,
      email: email!,
      token: token!,
      projectKey: projectKey!,
      authType: 'scoped_api_token',
    });
    const created = await connector.execute(
      {
        protocolVersion: 1,
        type: 'create_issue',
        subject: `Fairlead scoped token E2E ${crypto.randomUUID()}`,
        description: 'Created through the scoped API-token gateway path.',
      },
      { signal: new AbortController().signal },
    );
    expect(created).toMatchObject({ ok: true });
    issueKey = created.issueId;
  }, 30_000);

  afterAll(async () => {
    if (!issueKey) return;
    await fetch(
      `https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId!)}/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${btoa(`${email!}:${token!}`)}`,
          Accept: 'application/json',
        },
      },
    );
  }, 30_000);

  it('checks credentials, updates, reads, searches, and uploads through the scoped-token gateway', async () => {
    const signal = new AbortController().signal;
    await expect(connector.checkCredential(signal)).resolves.toBe(true);
    await expect(
      connector.execute(
        {
          protocolVersion: 1,
          type: 'update_issue',
          issueId: issueKey!,
          subject: 'Fairlead scoped token E2E updated',
          description: 'Updated through the scoped API-token gateway path.',
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
        {
          type: 'search',
          connectorId: 'jira',
          query: 'Fairlead scoped token E2E',
        } satisfies ReadOperation,
        { signal },
      ),
    ).resolves.toMatchObject({ ok: true });
    const attachment: ConnectorAttachment = {
      protocolVersion: 1,
      issueId: issueKey!,
      filename: `scoped-evidence-${crypto.randomUUID()}.txt`,
      contentType: 'text/plain',
      data: new Blob(['Scoped token attachment']).stream(),
      limitState: { exceeded: false, actualBytes: 23 },
    };
    await expect(connector.attach!(attachment, { signal })).resolves.toEqual({
      filename: attachment.filename,
      ok: true,
    });
  }, 30_000);
});
