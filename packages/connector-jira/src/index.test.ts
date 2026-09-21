import { describe, expect, it } from 'vitest';
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
