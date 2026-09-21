import { describe, expect, it } from 'vitest';
import type { ConnectorCommand } from '@fairlead/bridge-core';
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
});
