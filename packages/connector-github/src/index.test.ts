import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@fairlead/bridge-core';
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

describe('GithubConnector attachments', () => {
  const command = {
    protocolVersion: PROTOCOL_VERSION,
    target: { kind: 'none' as const },
    outcome: 'failed' as const,
    actions: [{ type: 'create_issue' as const }],
    idempotencyKey: 'k',
    callerId: 'u',
    connectorId: 'github',
    title: 'T',
    description: 'D',
    evidence: {
      mode: 'data_plane_reference' as const,
      sessionUrl: 'https://dp.example/e/my%20file%231.webm',
    },
  };
  type Call = { method: string; url: string; body?: unknown; signal?: AbortSignal | null };

  /** Routes fetches by "METHOD path-suffix"; unmatched requests fail the test. */
  function setup(routes: Record<string, () => Response>) {
    const calls: Call[] = [];
    const connector = new GithubConnector({
      owner: 'acme',
      repo: 'app',
      token: 't',
      fetch: (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const pathname = url.startsWith('https://dp.example')
          ? url
          : url.replace('https://api.github.com/repos/acme/app', '');
        calls.push({
          method,
          url: pathname,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          signal: init?.signal,
        });
        const key = Object.keys(routes).find((k) => `${method} ${pathname}`.startsWith(k));
        if (!key) throw new Error(`unexpected ${method} ${pathname}`);
        return routes[key]();
      }) as typeof fetch,
    });
    return { connector, calls };
  }
  const opts = () => ({ signal: new AbortController().signal });
  const okRoutes = {
    'POST /issues': () => Response.json({ number: 7, html_url: 'https://gh/i/7' }),
    'GET https://dp.example': () => new Response('bytes'),
    'GET /git/ref/heads/fairlead-attachments': () => Response.json({}),
    'GET /contents/': () => new Response('', { status: 404 }),
    'PUT /contents/': () => Response.json({ content: { html_url: 'https://gh/blob/main/a.webm' } }),
    'GET /issues/7/comments': () => Response.json([]),
    'POST /issues/7/comments': () => Response.json({}),
  };

  it('encodes the file name in the Contents path and links the blob URL in a comment', async () => {
    const { connector, calls } = setup(okRoutes);
    const result = await connector.execute(command, opts());
    expect(result.attachments?.[0].ok).toBe(true);
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('/contents/attachments/7/my%20file%231.webm');
    const comment = calls.find((c) => c.method === 'POST' && c.url === '/issues/7/comments')!;
    expect(JSON.stringify(comment.body)).toContain('https://gh/blob/main/a.webm');
    expect(JSON.stringify(comment.body)).not.toContain('/raw/');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('sends the existing sha when the attachment file already exists', async () => {
    const { connector, calls } = setup({
      ...okRoutes,
      'GET /contents/': () => Response.json({ sha: 'abc123' }),
    });
    await connector.execute(command, opts());
    const put = calls.find((c) => c.method === 'PUT')!;
    expect((put.body as { sha?: string }).sha).toBe('abc123');
  });

  it('does not post a duplicate attachment comment on retry', async () => {
    const link = '### Attachments\n- [my file#1.webm](https://gh/blob/main/a.webm)';
    const { connector, calls } = setup({
      ...okRoutes,
      'GET /issues/7/comments': () => Response.json([{ body: link }]),
    });
    const result = await connector.execute(command, opts());
    expect(result.attachments?.[0].ok).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.url === '/issues/7/comments')).toBe(false);
  });

  it.each([
    [
      'ref lookup',
      { 'GET /git/ref/heads/fairlead-attachments': () => new Response('', { status: 500 }) },
    ],
    ['contents lookup', { 'GET /contents/': () => new Response('', { status: 403 }) }],
  ])('reports a failed attachment when the %s errors', async (_name, override) => {
    const { connector } = setup({ ...okRoutes, ...override });
    const result = await connector.execute(command, opts());
    expect(result.ok).toBe(true);
    expect(result.attachments?.[0].ok).toBe(false);
  });

  it('reports a failed attachment when the default-branch lookup errors while creating the branch', async () => {
    const { connector } = setup({
      ...okRoutes,
      'GET /git/ref/heads/fairlead-attachments': () => new Response('', { status: 404 }),
      'GET /git/ref/heads/main': () => new Response('', { status: 500 }),
      // Repo lookup has an empty path suffix; listed last so the specific routes match first.
      'GET ': () => Response.json({ default_branch: 'main' }),
    });
    const result = await connector.execute(command, opts());
    expect(result.attachments?.[0]).toMatchObject({
      ok: false,
      error: { code: 'attachment_branch_failed' },
    });
  });

  it('forwards the abort signal to read requests', async () => {
    const { connector, calls } = setup({
      'GET /issues/5': () => Response.json({ number: 5, title: 't', html_url: 'u', state: 'open' }),
    });
    const controller = new AbortController();
    await connector.read(
      { type: 'fetch', connectorId: 'github', id: '5' },
      { signal: controller.signal },
    );
    expect(calls[0].signal).toBe(controller.signal);
  });
});
