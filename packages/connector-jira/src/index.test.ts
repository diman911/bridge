import { describe, expect, it, vi } from 'vitest';
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
  it('invokes the platform fetch with its global receiver', async () => {
    const nativeFetch = function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(Response.json({}));
    } as typeof fetch;
    vi.stubGlobal('fetch', nativeFetch);
    try {
      const connector = new JiraConnector({
        baseUrl: 'https://example.atlassian.net',
        projectKey: 'APP',
        token: 'token',
      });
      await expect(connector.checkCredential()).resolves.toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('requires cloudId for OAuth configuration', () => {
    expect(
      () =>
        new JiraConnector({
          baseUrl: 'https://example.atlassian.net',
          projectKey: 'APP',
          token: 'access-token',
          authType: 'oauth',
        }),
    ).toThrow('Jira OAuth configuration requires cloudId');
  });

  it('sends every OAuth operation through the Atlassian API gateway with a Bearer token', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const connector = new JiraConnector({
      // This is retained for human-facing browse links, but OAuth API calls
      // must never be sent to the tenant URL.
      baseUrl: 'https://example.atlassian.net',
      cloudId: 'cloud id/with reserved chars',
      projectKey: 'APP',
      token: 'access-token',
      authType: 'oauth',
      email: 'must-not-be-used@example.test',
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        const value = String(url);
        calls.push({ url: value, init });
        if (value.includes('/issue/picker')) return Response.json({ sections: [] });
        if (value.includes('?fields=attachment,project')) {
          return Response.json({
            fields: { project: { key: 'APP' }, attachment: [{ id: 'old', filename: 'a.txt' }] },
          });
        }
        if (value.includes('?fields=project'))
          return Response.json({ fields: { project: { key: 'APP' } } });
        if (value.includes('?fields=summary,status,project'))
          return Response.json({
            key: 'APP-1',
            fields: { summary: 'Title', project: { key: 'APP' } },
          });
        if (init?.method === 'POST' && value.endsWith('/issue')) return Response.json({ key: 'APP-1' });
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
    const signal = new AbortController().signal;

    await connector.checkCredential(signal);
    await connector.execute(
      { protocolVersion: 1, type: 'create_issue', subject: 'Title', description: 'Description' },
      { signal },
    );
    await connector.execute(
      { protocolVersion: 1, type: 'update_issue', issueId: 'APP-1', subject: 'Updated' },
      { signal },
    );
    await connector.read!({ type: 'fetch', connectorId: 'jira', id: 'APP-1' }, { signal });
    await connector.read!({ type: 'search', connectorId: 'jira', query: 'Title' }, { signal });
    await connector.attach!(
      {
        protocolVersion: 1,
        issueId: 'APP-1',
        filename: 'a.txt',
        contentType: 'text/plain',
        data: new Blob(['contents']).stream(),
        limitState: { exceeded: false, actualBytes: 8 },
      },
      { signal },
    );

    const oauthBase = 'https://api.atlassian.com/ex/jira/cloud%20id%2Fwith%20reserved%20chars';
    expect(calls).not.toHaveLength(0);
    for (const call of calls) {
      expect(call.url.startsWith(oauthBase)).toBe(true);
      expect(call.url).not.toContain('example.atlassian.net');
      expect(new Headers(call.init?.headers).get('authorization')).toBe('Bearer access-token');
    }
    expect(calls.map((call) => call.url)).toEqual(
      expect.arrayContaining([
        `${oauthBase}/rest/api/3/myself`,
        `${oauthBase}/rest/api/3/issue`,
        `${oauthBase}/rest/api/3/issue/APP-1?fields=project`,
        `${oauthBase}/rest/api/3/issue/APP-1?fields=summary,status,project`,
        `${oauthBase}/rest/api/3/issue/APP-1?fields=attachment,project`,
        `${oauthBase}/rest/api/3/issue/APP-1/attachments`,
        `${oauthBase}/rest/api/3/attachment/old`,
      ]),
    );
  });

  it('keeps direct Jira URL and Basic email:API-token authentication for API tokens', async () => {
    let request: { url: string; authorization: string | null } | undefined;
    const connector = new JiraConnector({
      baseUrl: 'https://example.atlassian.net/',
      cloudId: 'ignored-for-api-token',
      projectKey: 'APP',
      token: 'api-token',
      email: 'person@example.test',
      authType: 'api_token',
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        request = { url: String(url), authorization: new Headers(init?.headers).get('authorization') };
        return Response.json({});
      }) as typeof fetch,
    });

    await expect(connector.checkCredential()).resolves.toBe(true);
    expect(request).toEqual({
      url: 'https://example.atlassian.net/rest/api/3/myself',
      authorization: `Basic ${btoa('person@example.test:api-token')}`,
    });
  });

  it('uses the API gateway and Basic authentication for a scoped API token', async () => {
    let request: { url: string; authorization: string | null } | undefined;
    const connector = new JiraConnector({
      baseUrl: 'https://example.atlassian.net',
      cloudId: 'cloud-1',
      projectKey: 'APP',
      token: 'scoped-token',
      email: 'person@example.test',
      authType: 'scoped_api_token',
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        request = { url: String(url), authorization: new Headers(init?.headers).get('authorization') };
        return Response.json({});
      }) as typeof fetch,
    });

    await expect(connector.checkCredential()).resolves.toBe(true);
    expect(request).toEqual({
      url: 'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/myself',
      authorization: `Basic ${btoa('person@example.test:scoped-token')}`,
    });
  });

  it('requires a cloudId and email for a scoped API token', () => {
    expect(
      () =>
        new JiraConnector({
          baseUrl: 'https://example.atlassian.net',
          projectKey: 'APP',
          token: 'scoped-token',
          authType: 'scoped_api_token',
          email: 'person@example.test',
        }),
    ).toThrow('Jira scoped API token configuration requires cloudId');
    expect(
      () =>
        new JiraConnector({
          baseUrl: 'https://example.atlassian.net',
          cloudId: 'cloud-1',
          projectKey: 'APP',
          token: 'scoped-token',
          authType: 'scoped_api_token',
        }),
    ).toThrow('Jira scoped API token configuration requires email');
  });

  it('maps paragraph and single-line breaks to Jira ADF', async () => {
    let body: { fields: { description: unknown } } | undefined;
    const connector = new JiraConnector({
      baseUrl: 'https://example.atlassian.net',
      projectKey: 'APP',
      token: 'token',
      fetch: (async (_url: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ key: 'APP-1' });
      }) as typeof fetch,
    });

    await connector.execute(
      {
        protocolVersion: 1,
        type: 'create_issue',
        subject: 'Title',
        description: 'First line\nSecond line\n\nAnother paragraph',
      },
      { signal: new AbortController().signal },
    );

    expect(body?.fields.description).toEqual({
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'First line' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Second line' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Another paragraph' }] },
      ],
    });
  });

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
      limitState: { exceeded: false, actualBytes: 5 },
    };
    const result = await connector.attach(attachment, { signal: new AbortController().signal });
    expect(result).toMatchObject({
      ok: true,
      warnings: [{ code: 'previous_version_not_removed' }],
    });
    expect(calls.map((call) => call.split(' ')[0])).toEqual(['GET', 'POST', 'DELETE']);
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
