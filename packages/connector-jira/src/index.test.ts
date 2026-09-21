import { describe, expect, it } from 'vitest';
import type { ConnectorAttachment, ConnectorCommand } from '@fairlead/bridge-core';
import { runConnectorConformanceTests } from '@fairlead/bridge-core/conformance';
import { JiraConnector } from './index.js';

runConnectorConformanceTests(
  () =>
    new JiraConnector({
      baseUrl: 'https://example.atlassian.net',
      projectKey: 'APP',
      token: 'token',
      fetch: async () => new Response('', { status: 400 }),
    }),
);

describe('JiraConnector', () => {
  it('updates the fields present in a narrow command', async () => {
    const bodies: unknown[] = [];
    const connector = new JiraConnector({
      baseUrl: 'https://example.atlassian.net',
      projectKey: 'APP',
      token: 'token',
      fetch: (async (_url: string, init?: RequestInit) => {
        if (!init?.method)
          return Response.json({ fields: { description: null, project: { key: 'APP' } } });
        bodies.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
    const command: ConnectorCommand = {
      protocolVersion: 1,
      type: 'update_issue',
      issueId: 'APP-1',
      subject: 'New title',
      technicalSection: 'Browser: Chromium',
      idempotencyKey: 'k',
    };
    expect(
      await connector.execute(command, { signal: new AbortController().signal }),
    ).toMatchObject({
      ok: true,
      issueUrl: 'https://example.atlassian.net/browse/APP-1',
    });
    expect(bodies[0]).toMatchObject({ fields: { summary: 'New title' } });
  });

  it('uploads a replacement before deleting the previous attachment and warns on cleanup failure', async () => {
    const calls: string[] = [];
    const connector = new JiraConnector({
      baseUrl: 'https://example.atlassian.net',
      projectKey: 'APP',
      token: 'token',
      fetch: (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push(`${method} ${url}`);
        if (method === 'GET')
          return Response.json({
            fields: {
              project: { key: 'APP' },
              attachment: [{ id: 'old-1', filename: 'capture.har' }],
            },
          });
        if (method === 'POST') return Response.json([{ id: 'new-1' }]);
        return new Response('', { status: 500 });
      }) as typeof fetch,
    });
    const attachment: ConnectorAttachment = {
      protocolVersion: 1,
      issueId: 'APP-1',
      filename: 'capture.har',
      contentType: 'application/x-http-archive',
      data: new Blob(['bytes']).stream(),
      idempotencyKey: 'k',
      limitState: { exceeded: false, actualBytes: 5 },
    };
    const result = await connector.attach(attachment, { signal: new AbortController().signal });
    expect(result).toMatchObject({
      ok: true,
      warnings: [{ code: 'previous_version_not_removed' }],
    });
    expect(calls.map((call) => call.split(' ')[0])).toEqual(['GET', 'POST', 'DELETE']);
  });

  it('rejects multiple Fairlead ADF blocks without mutating the issue', async () => {
    let writes = 0;
    const block = {
      type: 'codeBlock',
      attrs: { language: 'fairlead' },
      content: [{ type: 'text', text: 'broken' }],
    };
    const connector = new JiraConnector({
      baseUrl: 'https://example.atlassian.net',
      projectKey: 'APP',
      token: 'token',
      fetch: (async (_url: string, init?: RequestInit) => {
        if (init?.method) writes++;
        return Response.json({
          fields: {
            description: { version: 1, type: 'doc', content: [block, block] },
            project: { key: 'APP' },
          },
        });
      }) as typeof fetch,
    });
    const command: ConnectorCommand = {
      protocolVersion: 1,
      type: 'update_issue',
      issueId: 'APP-1',
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

  it('replaces a previous attachment stored under the sanitized filename', async () => {
    const calls: string[] = [];
    const connector = new JiraConnector({
      baseUrl: 'https://example.atlassian.net',
      projectKey: 'APP',
      token: 'token',
      fetch: (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push(`${method} ${url}`);
        if (method === 'GET')
          return Response.json({
            fields: {
              project: { key: 'APP' },
              attachment: [{ id: 'old-1', filename: 'a_b.png' }],
            },
          });
        if (method === 'POST') return Response.json([{ id: 'new-1' }]);
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
    const result = await connector.attach(
      {
        protocolVersion: 1,
        issueId: 'APP-1',
        filename: 'a"b.png',
        contentType: 'image/png',
        data: new Blob(['bytes']).stream(),
        idempotencyKey: 'k',
        limitState: { exceeded: false, actualBytes: 5 },
      },
      { signal: new AbortController().signal },
    );
    expect(result).toEqual({ filename: 'a"b.png', ok: true });
    expect(
      calls.some((call) => call.startsWith('DELETE') && call.endsWith('/attachment/old-1')),
    ).toBe(true);
  });
});
