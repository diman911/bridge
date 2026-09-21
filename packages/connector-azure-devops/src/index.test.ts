import { describe, expect, it } from 'vitest';
import type { ConnectorAttachment, ConnectorCommand } from '@fairlead/bridge-core';
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

  it('uploads and links a replacement before deleting the previous blob', async () => {
    const methods: string[] = [];
    const connector = new AzureDevOpsConnector({
      organization: 'acme',
      project: 'app',
      token: 't',
      fetch: (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        methods.push(method);
        if (method === 'GET')
          return Response.json({
            relations: [
              {
                rel: 'AttachedFile',
                url: 'https://ado/old',
                attributes: { name: 'capture.har' },
              },
            ],
          });
        if (method === 'POST' && url.includes('/attachments'))
          return Response.json({ url: 'https://ado/new' });
        return Response.json({});
      }) as typeof fetch,
    });
    const attachment: ConnectorAttachment = {
      protocolVersion: 1,
      issueId: '12',
      filename: 'capture.har',
      contentType: 'application/x-http-archive',
      data: new Blob(['bytes']).stream(),
      idempotencyKey: 'k',
      limitState: { exceeded: false, actualBytes: 5 },
    };
    expect(
      await connector.attach(attachment, { signal: new AbortController().signal }),
    ).toMatchObject({
      ok: true,
    });
    expect(methods).toEqual(['GET', 'POST', 'PATCH', 'DELETE']);
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
