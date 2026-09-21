import { describe, expect, it } from 'vitest';
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

describe('AzureDevOpsConnector.read', () => {
  it('scopes WIQL search to the project and forwards the abort signal', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const connector = new AzureDevOpsConnector({
      organization: 'acme',
      project: 'app',
      token: 'token',
      fetch: (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return url.includes('/wiql')
          ? Response.json({ workItems: [] })
          : new Response('', { status: 500 });
      }) as typeof fetch,
    });
    const controller = new AbortController();
    const result = await connector.read(
      { type: 'search', connectorId: 'c', query: "it's" },
      { signal: controller.signal },
    );
    expect(result).toEqual({ ok: true, issues: [] });
    const body = JSON.parse(String(calls[0].init?.body)) as { query: string };
    expect(body.query).toContain('[System.TeamProject] = @project');
    expect(body.query).toContain("'it''s'");
    expect(calls[0].init?.signal).toBe(controller.signal);
  });
});
