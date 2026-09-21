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

describe('JiraConnector.read', () => {
  const make = (handler: (url: string, init?: RequestInit) => Response) =>
    new JiraConnector({
      baseUrl: 'https://example.atlassian.net',
      projectKey: 'APP',
      token: 'token',
      fetch: (async (url: URL | string, init?: RequestInit) =>
        handler(String(url), init)) as typeof fetch,
    });

  it('restricts search to the configured project and forwards the signal', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const connector = make((url, init) => {
      seen = { url, init };
      return Response.json({ sections: [] });
    });
    const controller = new AbortController();
    await connector.read(
      { type: 'search', connectorId: 'c', query: 'login' },
      { signal: controller.signal },
    );
    expect(new URL(seen!.url).searchParams.get('currentJQL')).toBe('project = APP');
    expect(seen!.init?.signal).toBe(controller.signal);
  });

  it('rejects fetching an issue from another project', async () => {
    const connector = make(() =>
      Response.json({ key: 'OTHER-1', fields: { summary: 's', project: { key: 'OTHER' } } }),
    );
    const result = await connector.read(
      { type: 'fetch', connectorId: 'c', id: 'OTHER-1' },
      { signal: new AbortController().signal },
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'issue_outside_project', message: expect.any(String) },
    });
  });
});

describe('JiraConnector.execute update', () => {
  const command = (artifacts: ConnectorCommand['artifacts'] = []): ConnectorCommand => ({
    protocolVersion: 1,
    intent: { action: 'update_issue', target: { kind: 'issue', id: 'APP-1' } },
    title: 'New title',
    description: '',
    technicalContext: {
      url: 'https://app.example.test',
      startedAt: 'a',
      stoppedAt: 'b',
      userActions: 1,
      networkRequests: 1,
      errors: 0,
    },
    artifacts,
    idempotencyKey: 'k',
  });
  const stored = {
    version: 1,
    type: 'doc',
    content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'keep me' }] }],
  };
  function setup(project = 'APP') {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    const connector = new JiraConnector({
      baseUrl: 'https://example.atlassian.net',
      projectKey: 'APP',
      token: 't',
      fetch: (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({
          method,
          url,
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
        });
        return method === 'GET'
          ? Response.json({ fields: { description: stored, project: { key: project } } })
          : new Response(null, { status: 204 });
      }) as typeof fetch,
    });
    return { connector, calls };
  }
  const options = () => ({ signal: new AbortController().signal });

  it('reads the issue, preserves its ADF, and adds the Fairlead block once', async () => {
    const { connector, calls } = setup();
    const result = await connector.execute(command(), options());
    expect(result).toMatchObject({
      ok: true,
      issueUrl: 'https://example.atlassian.net/browse/APP-1',
    });
    const put = calls.find((call) => call.method === 'PUT')!;
    const content = (put.body as { fields: { description: { content: unknown[] } } }).fields
      .description.content;
    expect(content[0]).toEqual(stored.content[0]);
    expect(content).toHaveLength(2);
  });

  it('refuses to update an issue outside the configured project', async () => {
    const { connector, calls } = setup('OTHER');
    const result = await connector.execute(command(), options());
    expect(result).toMatchObject({ ok: false, error: { code: 'issue_outside_project' } });
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('attaches every artifact and reports each outcome', async () => {
    const { connector, calls } = setup();
    const artifact = (filename: string) => ({
      filename,
      contentType: 'image/png',
      data: new Uint8Array([1, 2, 3]),
    });
    const result = await connector.execute(
      command([artifact('a.png'), artifact('b.png')]),
      options(),
    );
    expect(result.attachments).toEqual([
      { filename: 'a.png', ok: true },
      { filename: 'b.png', ok: true },
    ]);
    expect(calls.filter((call) => call.url.endsWith('/attachments'))).toHaveLength(2);
  });

  it('rejects add_comment as an unsupported action', async () => {
    const { connector } = setup();
    const result = await connector.execute(
      { ...command(), intent: { action: 'add_comment', target: { kind: 'issue', id: 'APP-1' } } },
      options(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported_action' } });
  });
});
