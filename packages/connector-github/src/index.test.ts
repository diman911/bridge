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
        if (url.endsWith('/issues/7') && (init?.method ?? 'GET') === 'GET')
          return Response.json({ body: 'Existing description' });
        if ((init?.method ?? 'GET') === 'GET') return Response.json({ sha: 'old-sha' });
        bodies.push(JSON.parse(String(init?.body)));
        return url.includes('/contents/')
          ? Response.json({
              content: {
                html_url: 'https://github.com/acme/app/blob/evidence/attachments/7/capture.har',
              },
            })
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
    expect(bodies[1]).toEqual({
      body: 'Existing description\n\n<!-- fairlead-bridge-attachments:start -->\n### Attachments\n- [capture.har](https://github.com/acme/app/raw/evidence/attachments/7/capture.har) <!-- fairlead-attachment:capture.har -->\n<!-- fairlead-bridge-attachments:end -->',
    });
  });

  it('renders screenshots in the issue body and keeps one entry per filename', async () => {
    let issueBody = 'User-authored description';
    let bodyUpdates = 0;
    const connector = new GithubConnector({
      owner: 'acme',
      repo: 'app',
      token: 't',
      fetch: (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (url.endsWith('/issues/7')) {
          if (method === 'GET') return Response.json({ body: issueBody });
          issueBody = (JSON.parse(String(init?.body)) as { body: string }).body;
          bodyUpdates++;
          return Response.json({});
        }
        if (url.includes('/contents/') && method === 'PUT')
          return Response.json({
            content: {
              html_url: `https://github.com/acme/app/blob/fairlead-attachments/${url.split('/contents/')[1]}`,
            },
          });
        if (url.includes('/contents/')) return new Response(null, { status: 404 });
        return Response.json({});
      }) as typeof fetch,
    });
    const attachment = (filename: string): ConnectorAttachment => ({
      protocolVersion: 1,
      issueId: '7',
      filename,
      contentType: 'image/png',
      data: new Blob(['bytes']).stream(),
      limitState: { exceeded: false, actualBytes: 5 },
    });
    const signal = new AbortController().signal;
    expect(await connector.attach(attachment('shot.png'), { signal })).toMatchObject({ ok: true });
    expect(await connector.attach(attachment('shot.png'), { signal })).toMatchObject({ ok: true });
    expect(await connector.attach(attachment('second.png'), { signal })).toMatchObject({
      ok: true,
    });
    expect(bodyUpdates).toBe(2);
    expect(issueBody).toContain('User-authored description\n\n');
    expect(issueBody.match(/!\[shot\.png\]/g)).toHaveLength(1);
    expect(issueBody.match(/!\[second\.png\]/g)).toHaveLength(1);
    expect(issueBody).toContain(
      '![shot.png](https://github.com/acme/app/raw/fairlead-attachments/attachments/7/shot.png)',
    );
  });
});
