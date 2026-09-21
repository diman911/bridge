import {
  PROTOCOL_VERSION,
  type Connector,
  type ConnectorExecutionOptions,
  type AttachmentResult,
  type EvidenceReference,
  type IntegrationCommand,
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
function base64(bytes: Uint8Array): string {
  let text = '';
  for (let start = 0; start < bytes.length; start += 0x8000)
    text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(text);
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
  async execute(c: IntegrationCommand, o: ConnectorExecutionOptions): Promise<IntegrationResult> {
    const a = c.actions.find((x) => x.type === 'create_issue' || x.type === 'update_issue');
    if (!a || !c.title || c.description === undefined)
      return {
        idempotencyKey: c.idempotencyKey,
        ok: false,
        error: {
          code: 'invalid_issue_command',
          message: 'create/update require title and description',
        },
      };
    const id = c.target.kind === 'issue' ? c.target.id : undefined;
    if (a.type === 'update_issue' && !id)
      return {
        idempotencyKey: c.idempotencyKey,
        ok: false,
        error: { code: 'missing_issue_id', message: 'update requires issue target' },
      };
    const r = await this.f(
      a.type === 'create_issue'
        ? this.path('/issues')
        : this.path(`/issues/${encodeURIComponent(id!)}`),
      {
        method: a.type === 'create_issue' ? 'POST' : 'PATCH',
        headers: this.h(true),
        body: JSON.stringify({ title: c.title, body: c.description }),
        signal: o.signal,
      },
    );
    if (!r.ok)
      return {
        idempotencyKey: c.idempotencyKey,
        ok: false,
        error: { code: 'github_request_failed', message: `${r.status} ${r.statusText}` },
      };
    const d = (await r.json()) as { number: number; html_url: string };
    const attachments = c.evidence
      ? [await this.attach(String(d.number), c.evidence, o.signal)]
      : undefined;
    return { idempotencyKey: c.idempotencyKey, ok: true, issueUrl: d.html_url, attachments };
  }
  async attach(id: string, e: EvidenceReference, signal: AbortSignal): Promise<AttachmentResult> {
    if (e.mode !== 'data_plane_reference')
      return {
        reference: e,
        ok: false,
        error: { code: 'unsupported_evidence', message: 'Data Plane reference required' },
      };
    try {
      const source = await this.f(e.sessionUrl, { signal });
      if (!source.ok)
        return {
          reference: e,
          ok: false,
          error: { code: 'attachment_fetch_failed', message: String(source.status) },
        };
      const branch = 'fairlead-attachments';
      const ref = await this.f(this.path(`/git/ref/heads/${branch}`), {
        headers: this.h(),
        signal,
      });
      if (ref.status === 404) {
        const repo = await this.f(this.path(''), { headers: this.h(), signal });
        const def = ((await repo.json()) as { default_branch: string }).default_branch;
        const head = await this.f(this.path(`/git/ref/heads/${def}`), {
          headers: this.h(),
          signal,
        });
        const sha = ((await head.json()) as { object: { sha: string } }).object.sha;
        const made = await this.f(this.path('/git/refs'), {
          method: 'POST',
          headers: this.h(true),
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
          signal,
        });
        if (!made.ok)
          return {
            reference: e,
            ok: false,
            error: { code: 'attachment_branch_failed', message: String(made.status) },
          };
      }
      const name = new URL(e.sessionUrl).pathname.split('/').pop() || 'evidence';
      const path = `attachments/${id}/${name}`;
      const put = await this.f(this.path(`/contents/${path}`), {
        method: 'PUT',
        headers: this.h(true),
        body: JSON.stringify({
          message: `Add attachment for issue #${id}`,
          content: base64(new Uint8Array(await source.arrayBuffer())),
          branch,
        }),
        signal,
      });
      if (!put.ok)
        return {
          reference: e,
          ok: false,
          error: { code: 'attachment_upload_failed', message: String(put.status) },
        };
      const uploaded = (await put.json()) as { content: { html_url: string } };
      const raw = uploaded.content.html_url.replace('/blob/', '/raw/');
      const issue = await this.f(this.path(`/issues/${id}`), { headers: this.h(), signal });
      if (!issue.ok)
        return {
          reference: e,
          ok: false,
          error: { code: 'attachment_link_failed', message: String(issue.status) },
        };
      const current = (await issue.json()) as { body: string | null };
      const body = `${current.body ?? ''}\n\n### Attachments\n- [${name}](${raw})`;
      const patch = await this.f(this.path(`/issues/${id}`), {
        method: 'PATCH',
        headers: this.h(true),
        body: JSON.stringify({ body }),
        signal,
      });
      return patch.ok
        ? { reference: e, ok: true }
        : {
            reference: e,
            ok: false,
            error: { code: 'attachment_link_failed', message: String(patch.status) },
          };
    } catch {
      return {
        reference: e,
        ok: false,
        error: { code: 'attachment_upload_failed', message: 'attachment request failed' },
      };
    }
  }
  async read(op: ReadOperation): Promise<ReadResult> {
    const u =
      op.type === 'search'
        ? `${this.base}/search/issues?q=${encodeURIComponent(`${op.query} repo:${this.c.owner}/${this.c.repo} type:issue`)}&per_page=10`
        : this.path(`/issues/${encodeURIComponent(op.id)}`);
    const r = await this.f(u, { headers: this.h() });
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
