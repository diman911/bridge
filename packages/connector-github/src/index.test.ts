import { describe, expect, it } from 'vitest';
import type { ConnectorAttachment, ConnectorCommand } from '@fairlead/bridge-core';
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
    };
    expect(
      await connector.execute(command, { signal: new AbortController().signal }),
    ).toMatchObject({
      ok: true,
      issueUrl: 'https://gh/i/7',
    });
    expect(body).toMatchObject({ title: 'Title' });
  });

  it('overwrites an attachment on the configured branch using its sha', async () => {
    const bodies: unknown[] = [];
    const connector = new GithubConnector({
      owner: 'acme',
      repo: 'app',
      token: 't',
      attachmentBranch: 'evidence',
      fetch: (async (url: string, init?: RequestInit) => {
        if (url.includes('/comments') && (init?.method ?? 'GET') === 'GET')
          return Response.json([]);
        if ((init?.method ?? 'GET') === 'GET') return Response.json({ sha: 'old-sha' });
        bodies.push(JSON.parse(String(init?.body)));
        return url.includes('/contents/')
          ? Response.json({ content: { html_url: 'u' } })
          : Response.json({});
      }) as typeof fetch,
    });
    const attachment: ConnectorAttachment = {
      protocolVersion: 1,
      issueId: '7',
      filename: 'capture.har',
      contentType: 'application/x-http-archive',
      data: new Blob(['bytes']).stream(),
      limitState: { exceeded: false, actualBytes: 5 },
    };
    expect(
      await connector.attach(attachment, { signal: new AbortController().signal }),
    ).toMatchObject({
      ok: true,
    });
    expect(bodies[0]).toMatchObject({ branch: 'evidence', sha: 'old-sha' });
  });
});
