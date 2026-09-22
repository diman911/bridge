import {
  PROTOCOL_VERSION,
  type Connector,
  type ConnectorCapabilities,
  type ConnectorCommand,
  type ConnectorExecutionOptions,
  type IntegrationResult,
  type ReadOperation,
  type ReadResult,
  type ConnectorAttachment,
  type ConnectorAttachmentOptions,
  type AttachmentResult,
} from '@fairlead/bridge-core';
export interface GithubConnectorConfig {
  token: string;
  owner: string;
  repo: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  attachmentBranch?: string;
}
function base64(bytes: Uint8Array): string {
  let text = '';
  for (let start = 0; start < bytes.length; start += 0x8000)
    text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(text);
}
function rawFileUrl(htmlUrl: string): string {
  // GitHub's Contents API returns a /blob/ page URL. The former extension
  // linked to /raw/ so screenshots render directly in issue Markdown.
  const url = new URL(htmlUrl);
  if (!url.pathname.includes('/blob/')) throw new Error('missing GitHub blob URL');
  url.pathname = url.pathname.replace('/blob/', '/raw/');
  return url.toString();
}
function markdownLabel(filename: string): string {
  return filename.replace(/[\\[\]]/g, '\\$&');
}
const ATTACHMENTS_START = '<!-- fairlead-bridge-attachments:start -->';
const ATTACHMENTS_END = '<!-- fairlead-bridge-attachments:end -->';

function withAttachment(body: string, filename: string, reference: string): string {
  const marker = `<!-- fairlead-attachment:${encodeURIComponent(filename)} -->`;
  const entry = `- ${reference} ${marker}`;
  const start = body.indexOf(ATTACHMENTS_START);
  const end = body.indexOf(ATTACHMENTS_END);
  if (start < 0 && end < 0)
    return `${body.trimEnd()}\n\n${ATTACHMENTS_START}\n### Attachments\n${entry}\n${ATTACHMENTS_END}`.trimStart();
  if (start < 0 || end < start) throw new Error('malformed Fairlead attachments section');
  const section = body.slice(start, end);
  const lines = section.split('\n');
  const existing = lines.findIndex((line) => line.endsWith(marker));
  if (existing >= 0) lines[existing] = entry;
  else lines.splice(lines[lines.length - 1] === '' ? -1 : lines.length, 0, entry);
  return body.slice(0, start) + lines.join('\n') + body.slice(end);
}
export class GithubConnector implements Connector {
  readonly capabilities: ConnectorCapabilities = {
    protocolVersion: PROTOCOL_VERSION,
    connectorId: 'github',
    displayName: 'GitHub Issues',
    targets: {
      issue: {
        actions: ['create', 'update'],
        reads: ['fetch', 'search'],
        attachments: true,
      },
    },
  };
  private f;
  private base;
  constructor(private c: GithubConnectorConfig) {
    // Workers' fetch requires the global object as its `this` value.
    this.f = c.fetch ?? globalThis.fetch.bind(globalThis);
    this.base = (c.baseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  }
  private h(json = false) {
    return {
      Authorization: `Bearer ${this.c.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'fairlead-bridge',
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
      ok: false,
      error: { code, message },
    });
    const { type } = c;
    const r = await this.f(
      type === 'create_issue'
        ? this.path('/issues')
        : this.path(`/issues/${encodeURIComponent(c.issueId)}`),
      {
        method: type === 'create_issue' ? 'POST' : 'PATCH',
        headers: this.h(true),
        body: JSON.stringify({
          ...(c.subject === undefined ? {} : { title: c.subject }),
          ...(c.description === undefined ? {} : { body: c.description }),
        }),
        signal: o.signal,
      },
    );
    if (!r.ok) return fail('github_request_failed', `${r.status} ${r.statusText}`);
    const d = (await r.json()) as { number: number; html_url: string };
    return {
      ok: true,
      issueId: String(d.number),
      issueUrl: d.html_url,
    };
  }
  async attach(
    attachment: ConnectorAttachment,
    options: ConnectorAttachmentOptions,
  ): Promise<AttachmentResult> {
    const fail = (code: string, message: string): AttachmentResult => ({
      filename: attachment.filename,
      ok: false,
      error: { code, message },
    });
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = attachment.data.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(next.value);
        size += next.value.byteLength;
      }
      const data = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const branch = this.c.attachmentBranch ?? 'fairlead-attachments';
      const branchRef = await this.f(this.path(`/git/ref/heads/${encodeURIComponent(branch)}`), {
        headers: this.h(),
        signal: options.signal,
      });
      if (!branchRef.ok && branchRef.status !== 404)
        return fail('attachment_branch_failed', String(branchRef.status));
      if (branchRef.status === 404) {
        const repository = await this.f(this.path(''), {
          headers: this.h(),
          signal: options.signal,
        });
        if (!repository.ok) return fail('attachment_branch_failed', String(repository.status));
        const defaultBranch = ((await repository.json()) as { default_branch: string })
          .default_branch;
        const head = await this.f(
          this.path(`/git/ref/heads/${encodeURIComponent(defaultBranch)}`),
          { headers: this.h(), signal: options.signal },
        );
        if (!head.ok) return fail('attachment_branch_failed', String(head.status));
        const commitSha = ((await head.json()) as { object: { sha: string } }).object.sha;
        const created = await this.f(this.path('/git/refs'), {
          method: 'POST',
          headers: this.h(true),
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitSha }),
          signal: options.signal,
        });
        if (!created.ok) return fail('attachment_branch_failed', String(created.status));
      }
      const path = `attachments/${encodeURIComponent(attachment.issueId)}/${encodeURIComponent(attachment.filename)}`;
      const existing = await this.f(
        this.path(`/contents/${path}?ref=${encodeURIComponent(branch)}`),
        {
          headers: this.h(),
          signal: options.signal,
        },
      );
      if (!existing.ok && existing.status !== 404)
        return fail('attachment_lookup_failed', String(existing.status));
      const sha = existing.ok ? ((await existing.json()) as { sha: string }).sha : undefined;
      const upload = await this.f(this.path(`/contents/${path}`), {
        method: 'PUT',
        headers: this.h(true),
        body: JSON.stringify({
          message: `Replace attachment for issue #${attachment.issueId}`,
          content: base64(data),
          branch,
          ...(sha ? { sha } : {}),
        }),
        signal: options.signal,
      });
      if (!upload.ok) return fail('attachment_upload_failed', String(upload.status));
      const htmlUrl = ((await upload.json()) as { content: { html_url: string } }).content.html_url;
      const link = rawFileUrl(htmlUrl);
      const label = markdownLabel(attachment.filename);
      const reference = attachment.contentType.startsWith('image/')
        ? `![${label}](${link})`
        : `[${label}](${link})`;
      const issueUrl = this.path(`/issues/${encodeURIComponent(attachment.issueId)}`);
      const issue = await this.f(issueUrl, { headers: this.h(), signal: options.signal });
      if (!issue.ok) return fail('attachment_link_failed', String(issue.status));
      const currentBody = ((await issue.json()) as { body?: string | null }).body ?? '';
      const updatedBody = withAttachment(currentBody, attachment.filename, reference);
      if (updatedBody === currentBody) return { filename: attachment.filename, ok: true };
      const updated = await this.f(issueUrl, {
        method: 'PATCH',
        headers: this.h(true),
        body: JSON.stringify({ body: updatedBody }),
        signal: options.signal,
      });
      return updated.ok
        ? { filename: attachment.filename, ok: true }
        : fail('attachment_link_failed', String(updated.status));
    } catch {
      return attachment.limitState.exceeded
        ? fail('attachment_too_large', 'attachment exceeds limit')
        : fail('attachment_upload_failed', 'attachment request failed');
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
      body?: string | null;
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
      issue: {
        id: String(d.number),
        title: d.title,
        url: d.html_url,
        status: d.state,
        description: d.body ?? '',
        rawDescription: d.body ?? '',
        attachments: [],
      },
    };
  }
}
