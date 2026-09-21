import {
  PROTOCOL_VERSION,
  mergeMarkdown,
  type Connector,
  type ConnectorCommand,
  type ConnectorExecutionOptions,
  type AttachmentResult,
  type ReportArtifact,
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
  async execute(c: ConnectorCommand, o: ConnectorExecutionOptions): Promise<IntegrationResult> {
    const fail = (code: string, message: string): IntegrationResult => ({
      idempotencyKey: c.idempotencyKey,
      ok: false,
      error: { code, message },
    });
    const { intent } = c;
    if (intent.action !== 'create_issue' && intent.action !== 'update_issue')
      return fail('unsupported_action', `connector does not support action ${intent.action}`);
    let existing = '';
    if (intent.action === 'update_issue') {
      const current = await this.f(this.path(`/issues/${encodeURIComponent(intent.target.id)}`), {
        headers: this.h(),
        signal: o.signal,
      });
      if (!current.ok)
        return fail('github_request_failed', `${current.status} ${current.statusText}`);
      existing = ((await current.json()) as { body?: string | null }).body ?? '';
    }
    const r = await this.f(
      intent.action === 'create_issue'
        ? this.path('/issues')
        : this.path(`/issues/${encodeURIComponent(intent.target.id)}`),
      {
        method: intent.action === 'create_issue' ? 'POST' : 'PATCH',
        headers: this.h(true),
        body: JSON.stringify({
          title: c.title,
          body: mergeMarkdown(existing, c.description, c.technicalContext),
        }),
        signal: o.signal,
      },
    );
    if (!r.ok) return fail('github_request_failed', `${r.status} ${r.statusText}`);
    const d = (await r.json()) as { number: number; html_url: string };
    const attachments: AttachmentResult[] = [];
    // Sequential on purpose: concurrent Contents API commits to one branch conflict (409).
    for (const artifact of c.artifacts)
      attachments.push(
        await this.attach(String(d.number), artifact, o.attachmentSignal ?? o.signal),
      );
    return {
      idempotencyKey: c.idempotencyKey,
      ok: true,
      issueUrl: d.html_url,
      attachments: attachments.length ? attachments : undefined,
    };
  }
  async attach(
    id: string,
    artifact: ReportArtifact,
    signal: AbortSignal,
  ): Promise<AttachmentResult> {
    const name = artifact.filename;
    try {
      const branch = 'fairlead-attachments';
      const ref = await this.f(this.path(`/git/ref/heads/${branch}`), {
        headers: this.h(),
        signal,
      });
      if (!ref.ok && ref.status !== 404)
        return {
          filename: name,
          ok: false,
          error: { code: 'attachment_branch_failed', message: String(ref.status) },
        };
      if (ref.status === 404) {
        const repo = await this.f(this.path(''), { headers: this.h(), signal });
        if (!repo.ok)
          return {
            filename: name,
            ok: false,
            error: { code: 'attachment_branch_failed', message: String(repo.status) },
          };
        const def = ((await repo.json()) as { default_branch: string }).default_branch;
        const head = await this.f(this.path(`/git/ref/heads/${def}`), {
          headers: this.h(),
          signal,
        });
        if (!head.ok)
          return {
            filename: name,
            ok: false,
            error: { code: 'attachment_branch_failed', message: String(head.status) },
          };
        const sha = ((await head.json()) as { object: { sha: string } }).object.sha;
        const made = await this.f(this.path('/git/refs'), {
          method: 'POST',
          headers: this.h(true),
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
          signal,
        });
        if (!made.ok)
          return {
            filename: name,
            ok: false,
            error: { code: 'attachment_branch_failed', message: String(made.status) },
          };
      }
      const path = `attachments/${encodeURIComponent(id)}/${encodeURIComponent(name)}`;
      const existing = await this.f(this.path(`/contents/${path}?ref=${branch}`), {
        headers: this.h(),
        signal,
      });
      if (!existing.ok && existing.status !== 404)
        return {
          filename: name,
          ok: false,
          error: { code: 'attachment_upload_failed', message: String(existing.status) },
        };
      const existingSha = existing.ok
        ? ((await existing.json()) as { sha: string }).sha
        : undefined;
      const put = await this.f(this.path(`/contents/${path}`), {
        method: 'PUT',
        headers: this.h(true),
        body: JSON.stringify({
          message: `Add attachment for issue #${id}`,
          content: base64(artifact.data),
          branch,
          ...(existingSha ? { sha: existingSha } : {}),
        }),
        signal,
      });
      if (!put.ok)
        return {
          filename: name,
          ok: false,
          error: { code: 'attachment_upload_failed', message: String(put.status) },
        };
      const uploaded = (await put.json()) as { content: { html_url: string } };
      // Blob (not /raw/) link: it opens for anyone with repo access, including private repos.
      const link = uploaded.content.html_url;
      const commentBody = `### Attachments\n- [${name}](${link})`;
      const comments = await this.f(this.path(`/issues/${id}/comments?per_page=100`), {
        headers: this.h(),
        signal,
      });
      if (comments.ok) {
        const list = (await comments.json()) as { body?: string | null }[];
        if (list.some((x) => x.body === commentBody)) return { filename: name, ok: true };
      }
      const comment = await this.f(this.path(`/issues/${id}/comments`), {
        method: 'POST',
        headers: this.h(true),
        body: JSON.stringify({ body: commentBody }),
        signal,
      });
      return comment.ok
        ? { filename: name, ok: true }
        : {
            filename: name,
            ok: false,
            error: { code: 'attachment_link_failed', message: String(comment.status) },
          };
    } catch {
      return {
        filename: name,
        ok: false,
        error: { code: 'attachment_upload_failed', message: 'attachment request failed' },
      };
    }
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
