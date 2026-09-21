import { describe, expect, it } from 'vitest';
import type { ConnectorCommand } from '@fairlead/bridge-core';
import { runConnectorConformanceTests } from '@fairlead/bridge-core/conformance';
import { AzureDevOpsConnector } from './index.js';

runConnectorConformanceTests(
  () =>
    new AzureDevOpsConnector({
      organization: 'acme',
      project: 'app',
      token: 'token',
      fetch: async () => new Response('', { status: 400 }),
    }),
);

describe('AzureDevOpsConnector', () => {
  it('maps a narrow create command to a work-item patch', async () => {
    let patch: unknown;
    const connector = new AzureDevOpsConnector({
      organization: 'acme',
      project: 'app',
      token: 't',
      fetch: (async (_url: string, init?: RequestInit) => {
        patch = JSON.parse(String(init?.body));
        return Response.json({ id: 12, url: 'u' });
      }) as typeof fetch,
    });
    const command: ConnectorCommand = {
      protocolVersion: 1,
      type: 'create_issue',
      subject: 'Title',
      description: '',
      idempotencyKey: 'k',
    };
    expect(
      await connector.execute(command, { signal: new AbortController().signal }),
    ).toMatchObject({ ok: true });
    expect(patch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/fields/System.Title', value: 'Title' }),
      ]),
    );
  });

  it('returns description_conflict for malformed managed HTML', async () => {
    let writes = 0;
    const connector = new AzureDevOpsConnector({
      organization: 'acme',
      project: 'app',
      token: 't',
      fetch: (async (_url: string, init?: RequestInit) => {
        if (init?.method) writes++;
        return Response.json({
          fields: { 'System.Description': '<pre><code class="language-fairlead">unclosed' },
        });
      }) as typeof fetch,
    });
    const command: ConnectorCommand = {
      protocolVersion: 1,
      type: 'update_issue',
      issueId: '12',
      technicalSection: 'replacement',
      idempotencyKey: 'k',
    };
    expect(
      await connector.execute(command, { signal: new AbortController().signal }),
    ).toMatchObject({
      ok: false,
      error: { code: 'description_conflict' },
    });
    expect(writes).toBe(0);
  });
});
