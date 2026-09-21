import { describe, expect, it } from 'vitest';
import type { ConnectorCommand } from '@fairlead/bridge-core';
import { runConnectorConformanceTests } from '@fairlead/bridge-core/conformance';
import { GithubConnector } from './index.js';

runConnectorConformanceTests(
  () =>
    new GithubConnector({
      owner: 'acme',
      repo: 'app',
      token: 'token',
      fetch: async () => new Response('', { status: 400 }),
    }),
);

describe('GithubConnector', () => {
  it('maps a narrow create command to the Issues API', async () => {
    let body: unknown;
    const connector = new GithubConnector({
      owner: 'acme',
      repo: 'app',
      token: 't',
      fetch: (async (_url: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ number: 7, html_url: 'https://gh/i/7' });
      }) as typeof fetch,
    });
    const command: ConnectorCommand = {
      protocolVersion: 1,
      type: 'create_issue',
      subject: 'Title',
      description: 'Description',
      technicalSection: 'Browser: Chromium',
      idempotencyKey: 'k',
    };
    expect(
      await connector.execute(command, { signal: new AbortController().signal }),
    ).toMatchObject({
      ok: true,
      issueUrl: 'https://gh/i/7',
    });
    expect(body).toMatchObject({ title: 'Title' });
  });
});
