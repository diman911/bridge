import { describe, expect, it } from 'vitest';
import type { ConnectorAttachment, ConnectorCommand } from '@fairlead/bridge-core';
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

describe('AzureDevOpsConnector', () => {
  it('maps a narrow create command to a work-item patch', async () => {
    let patch: unknown;
    const connector = new AzureDevOpsConnector({
      organization: 'acme',
      project: 'app',
      token: 't',
      fetch: (async (_url: string, init?: RequestInit) => {
        patch = JSON.parse(String(init?.body));
        return Response.json({ id: 12, url: 'u' });
      }) as typeof fetch,
    });
    const command: ConnectorCommand = {
      protocolVersion: 1,
      type: 'create_issue',
      subject: 'Title',
      description: '',
    };
    expect(
      await connector.execute(command, { signal: new AbortController().signal }),
    ).toMatchObject({ ok: true });
    expect(patch).toEqual([
      { op: 'add', path: '/fields/System.Title', value: 'Title' },
      { op: 'add', path: '/fields/System.Description', value: '' },
    ]);
  });

  it('selects Bug from the create URL and does not patch Area or Iteration', async () => {
    let url = '';
    let patch: { path: string }[] = [];
    const connector = new AzureDevOpsConnector({
      organization: 'acme',
      project: 'app',
      token: 't',
      fetch: (async (requestUrl: string, init?: RequestInit) => {
        url = requestUrl;
        patch = JSON.parse(String(init?.body));
        return Response.json({ id: 12 });
      }) as typeof fetch,
    });

    await connector.execute(
      { protocolVersion: 1, type: 'create_issue', subject: 'Title', description: 'Description' },
      { signal: new AbortController().signal },
    );

    expect(url).toContain('/_apis/wit/workitems/$Bug?api-version=7.1');
    expect(patch.map((operation) => operation.path)).not.toContain('/fields/System.WorkItemType');
    expect(patch.map((operation) => operation.path)).not.toContain('/fields/System.AreaPath');
    expect(patch.map((operation) => operation.path)).not.toContain('/fields/System.IterationPath');
  });

  it('uses Basic authentication for a PAT and Bearer authentication for OAuth', async () => {
    const authorizations: string[] = [];
    const makeConnector = (authType: 'api_token' | 'oauth') =>
      new AzureDevOpsConnector({
        organization: 'acme',
        project: 'app',
        token: 'token',
        authType,
        fetch: (async (_url: string, init?: RequestInit) => {
          authorizations.push(new Headers(init?.headers).get('Authorization') ?? '');
          return Response.json({ id: 12 });
        }) as typeof fetch,
      });

    await makeConnector('api_token').execute(
      { protocolVersion: 1, type: 'create_issue', subject: 'Title', description: 'Description' },
      { signal: new AbortController().signal },
    );
    await makeConnector('oauth').execute(
      { protocolVersion: 1, type: 'create_issue', subject: 'Title', description: 'Description' },
      { signal: new AbortController().signal },
    );

    expect(authorizations).toEqual([`Basic ${btoa(':token')}`, 'Bearer token']);
  });

  it('recognizes only a JSON 200 project-list response as valid credentials', async () => {
    const calls: RequestInit[] = [];
    const connector = new AzureDevOpsConnector({
      organization: 'acme',
      project: 'app',
      token: 't',
      fetch: (async (_url: string, init?: RequestInit) => {
        calls.push(init ?? {});
        return new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch,
    });
    await expect(connector.checkCredential()).resolves.toBe(true);
    expect(calls[0]).toMatchObject({ redirect: 'manual' });

    const redirected = new AzureDevOpsConnector({
      organization: 'acme',
      project: 'app',
      token: 't',
      fetch: (async () => new Response('', { status: 302 })) as typeof fetch,
    });
    await expect(redirected.checkCredential()).resolves.toBe(false);
  });

  it('uploads and links a replacement before deleting the previous blob', async () => {
    const methods: string[] = [];
    const connector = new AzureDevOpsConnector({
      organization: 'acme',
      project: 'app',
      token: 't',
      fetch: (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        methods.push(method);
        if (method === 'GET')
          return Response.json({
            relations: [
              {
                rel: 'AttachedFile',
                url: 'https://ado/old',
                attributes: { name: 'capture.har' },
              },
            ],
          });
        if (method === 'POST' && url.includes('/attachments'))
          return Response.json({ url: 'https://ado/new' });
        return Response.json({});
      }) as typeof fetch,
    });
    const attachment: ConnectorAttachment = {
      protocolVersion: 1,
      issueId: '12',
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
    expect(methods).toEqual(['GET', 'POST', 'PATCH', 'DELETE']);
  });

  it('guards relation removal with a revision test', async () => {
    const bodies: string[] = [];
    const connector = new AzureDevOpsConnector({
      organization: 'acme',
      project: 'app',
      token: 't',
      fetch: (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'GET')
          return Response.json({
            rev: 7,
            relations: [
              { rel: 'AttachedFile', url: 'https://ado/old', attributes: { name: 'a.har' } },
            ],
          });
        if (method === 'POST' && url.includes('/attachments'))
          return Response.json({ url: 'https://ado/new' });
        if (method === 'PATCH') bodies.push(String(init?.body));
        return Response.json({});
      }) as typeof fetch,
    });
    await connector.attach(
      {
        protocolVersion: 1,
        issueId: '12',
        filename: 'a.har',
        contentType: 'application/octet-stream',
        data: new Blob(['bytes']).stream(),
        limitState: { exceeded: false, actualBytes: 5 },
      },
      { signal: new AbortController().signal },
    );
    expect(JSON.parse(bodies[0]!)[0]).toEqual({ op: 'test', path: '/rev', value: 7 });
  });
});
