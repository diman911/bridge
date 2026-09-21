import { describe, expect, it } from 'vitest';
import type { ConnectorCommand } from '@fairlead/bridge-core';
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

describe('AzureDevOpsConnector.execute', () => {
  const command: ConnectorCommand = {
    protocolVersion: 1,
    intent: { action: 'update_issue', target: { kind: 'issue', id: '12' } },
    title: 'T',
    description: '',
    technicalContext: {
      url: 'https://app.example.test',
      startedAt: 'a',
      stoppedAt: 'b',
      userActions: 1,
      networkRequests: 1,
      errors: 0,
    },
    artifacts: [{ filename: 'a.png', contentType: 'image/png', data: new Uint8Array([1]) }],
    idempotencyKey: 'k',
  };

  it('merges into the existing HTML description and uploads each artifact', async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    const connector = new AzureDevOpsConnector({
      organization: 'acme',
      project: 'app',
      token: 't',
      fetch: (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ method, url, body: init?.body });
        if (method === 'GET')
          return Response.json({ fields: { 'System.Description': '<p>Kept</p>' } });
        if (url.includes('/attachments')) return Response.json({ url: 'https://ado/att/1' });
        return Response.json({ id: 12, url: 'u' });
      }) as typeof fetch,
    });
    const result = await connector.execute(command, { signal: new AbortController().signal });
    expect(result).toMatchObject({ ok: true, attachments: [{ filename: 'a.png', ok: true }] });
    const patch = calls.find((c) => c.method === 'PATCH')!;
    const description = (JSON.parse(String(patch.body)) as { path: string; value: string }[]).find(
      (op) => op.path === '/fields/System.Description',
    )!.value;
    expect(description.startsWith('<p>Kept</p>')).toBe(true);
    expect(description.split('Fairlead technical context')).toHaveLength(2);
  });

  it('links all uploaded files with a single PATCH and reports a failed upload separately', async () => {
    const patches: string[] = [];
    const connector = new AzureDevOpsConnector({
      organization: 'acme',
      project: 'app',
      token: 't',
      fetch: (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'GET') return Response.json({ fields: {} });
        if (url.includes('/attachments'))
          return url.includes('bad.png')
            ? new Response('', { status: 500 })
            : Response.json({ url: `https://ado/att/${url.includes('a.png') ? 1 : 2}` });
        patches.push(String(init?.body));
        return Response.json({ id: 12, url: 'u' });
      }) as typeof fetch,
    });
    const file = (filename: string) => ({
      filename,
      contentType: 'image/png',
      data: new Uint8Array([1]),
    });
    const result = await connector.execute(
      { ...command, artifacts: [file('a.png'), file('bad.png'), file('c.png')] },
      { signal: new AbortController().signal },
    );
    expect(result.attachments?.map((a) => [a.filename, a.ok])).toEqual([
      ['a.png', true],
      ['bad.png', false],
      ['c.png', true],
    ]);
    // one PATCH for the description, one linking both uploaded files
    expect(patches).toHaveLength(2);
    expect(JSON.parse(patches[1])).toHaveLength(2);
  });
});
