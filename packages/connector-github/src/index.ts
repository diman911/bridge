import {
  PROTOCOL_VERSION,
  mergeMarkdown,
  type Connector,
  type ConnectorCommand,
  type ConnectorExecutionOptions,
  type IntegrationResult,
  type ReadOperation,
  type ReadResult,
} from '@fairlead/bridge-core';
export interface GithubConnectorConfig {
  token: string;
  owner: string;
  repo: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}
export class GithubConnector implements Connector {
  readonly capabilities = {
    protocolVersion: PROTOCOL_VERSION,
    connectorId: 'github',
    displayName: 'GitHub Issues',
    supportedTargets: ['issue'] as 'issue'[],
    supportedActions: ['create_issue', 'update_issue'] as ('create_issue' | 'update_issue')[],
    verdictMappings: {},
  };
  private f;
  private base;
  constructor(private c: GithubConnectorConfig) {
    this.f = c.fetch ?? fetch;
    this.base = (c.baseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  }
  private h(json = false) {
    return {
      Authorization: `Bearer ${this.c.token}`,
      Accept: 'application/vnd.github+json',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }
  private path(p: string) {
    return `${this.base}/repos/${encodeURIComponent(this.c.owner)}/${encodeURIComponent(this.c.repo)}${p}`;
  }
  async checkCredential(signal?: AbortSignal) {
    return (await this.f(`${this.base}/user`, { headers: this.h(), signal })).ok;
  }
  async execute(c: ConnectorCommand, o: ConnectorExecutionOptions): Promise<IntegrationResult> {
    const fail = (code: string, message: string): IntegrationResult => ({
      idempotencyKey: c.idempotencyKey,
      ok: false,
      error: { code, message },
    });
    const { type } = c;
    const changesDescription = c.description !== undefined || c.technicalSection !== undefined;
    let existing = '';
    if (type === 'update_issue' && changesDescription) {
      const current = await this.f(this.path(`/issues/${encodeURIComponent(c.issueId)}`), {
        headers: this.h(),
        signal: o.signal,
      });
      if (!current.ok)
        return fail('github_request_failed', `${current.status} ${current.statusText}`);
      existing = ((await current.json()) as { body?: string | null }).body ?? '';
    }
    const merged = changesDescription ? mergeMarkdown(existing, c) : undefined;
    if (merged && !merged.ok) return fail(merged.error.code, merged.error.message);
    const r = await this.f(
      type === 'create_issue'
        ? this.path('/issues')
        : this.path(`/issues/${encodeURIComponent(c.issueId)}`),
      {
        method: type === 'create_issue' ? 'POST' : 'PATCH',
        headers: this.h(true),
        body: JSON.stringify({
          ...(c.subject === undefined ? {} : { title: c.subject }),
          ...(merged?.ok ? { body: merged.value } : {}),
        }),
        signal: o.signal,
      },
    );
    if (!r.ok) return fail('github_request_failed', `${r.status} ${r.statusText}`);
    const d = (await r.json()) as { number: number; html_url: string };
    return {
      idempotencyKey: c.idempotencyKey,
      ok: true,
      issueUrl: d.html_url,
    };
  }
  async read(op: ReadOperation, options: ConnectorExecutionOptions): Promise<ReadResult> {
    const u =
      op.type === 'search'
        ? `${this.base}/search/issues?q=${encodeURIComponent(`${op.query} repo:${this.c.owner}/${this.c.repo} type:issue`)}&per_page=10`
        : this.path(`/issues/${encodeURIComponent(op.id)}`);
    const r = await this.f(u, { headers: this.h(), signal: options.signal });
    if (!r.ok)
      return { ok: false, error: { code: 'github_request_failed', message: String(r.status) } };
    const d = (await r.json()) as {
      items?: { number: number; title: string; html_url: string; state: string }[];
      number: number;
      title: string;
      html_url: string;
      state: string;
    };
    if (op.type === 'search')
      return {
        ok: true,
        issues: (d.items ?? []).map((i) => ({
          id: String(i.number),
          title: i.title,
          url: i.html_url,
          status: i.state,
        })),
      };
    return {
      ok: true,
      issue: { id: String(d.number), title: d.title, url: d.html_url, status: d.state },
    };
  }
}
