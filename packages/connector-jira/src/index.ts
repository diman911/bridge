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
export interface JiraConnectorConfig {
  baseUrl: string;
  token: string;
  projectKey: string;
  authType?: 'oauth' | 'api_token';
  email?: string;
  fetch?: typeof fetch;
}
const adf = (text: string) => ({
  version: 1,
  type: 'doc',
  content: text
    .split(/\n\n+/)
    .map((p) => ({ type: 'paragraph', content: p ? [{ type: 'text', text: p }] : [] })),
});
export class JiraConnector implements Connector {
  readonly capabilities = {
    protocolVersion: PROTOCOL_VERSION,
    connectorId: 'jira',
    displayName: 'Jira Cloud',
    supportedTargets: ['issue'] as 'issue'[],
    supportedActions: ['create_issue', 'update_issue'] as ('create_issue' | 'update_issue')[],
    verdictMappings: {},
  };
  private base;
  private f;
  constructor(private c: JiraConnectorConfig) {
    this.base = c.baseUrl.replace(/\/+$/, '');
    this.f = c.fetch ?? fetch;
  }
  private h(json = false) {
    const authorization =
      this.c.authType === 'api_token' && this.c.email
        ? `Basic ${btoa(`${this.c.email}:${this.c.token}`)}`
        : `Bearer ${this.c.token}`;
    return {
      Authorization: authorization,
      Accept: 'application/json',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }
  async checkCredential(signal?: AbortSignal) {
    const r = await this.f(`${this.base}/rest/api/3/myself`, { headers: this.h(), signal });
    return r.ok;
  }
  async execute(
    command: IntegrationCommand,
    o: ConnectorExecutionOptions,
  ): Promise<IntegrationResult> {
    const a = command.actions.find((x) => x.type === 'create_issue' || x.type === 'update_issue');
    if (!a || !command.title || command.description === undefined)
      return {
        idempotencyKey: command.idempotencyKey,
        ok: false,
        error: {
          code: 'invalid_issue_command',
          message: 'create/update require title and description',
        },
      };
    const key = command.target.kind === 'issue' ? command.target.id : undefined;
    if (a.type === 'update_issue' && !key)
      return {
        idempotencyKey: command.idempotencyKey,
        ok: false,
        error: { code: 'missing_issue_id', message: 'update requires issue target' },
      };
    const r = await this.f(
      a.type === 'create_issue'
        ? `${this.base}/rest/api/3/issue`
        : `${this.base}/rest/api/3/issue/${encodeURIComponent(key!)}`,
      {
        method: a.type === 'create_issue' ? 'POST' : 'PUT',
        headers: this.h(true),
        body: JSON.stringify(
          a.type === 'create_issue'
            ? {
                fields: {
                  project: { key: this.c.projectKey },
                  summary: command.title,
                  description: adf(command.description),
                  issuetype: { name: 'Bug' },
                },
              }
            : { fields: { summary: command.title, description: adf(command.description) } },
        ),
        signal: o.signal,
      },
    );
    if (!r.ok)
      return {
        idempotencyKey: command.idempotencyKey,
        ok: false,
        error: { code: 'jira_request_failed', message: `${r.status} ${r.statusText}` },
      };
    const resolved = a.type === 'create_issue' ? ((await r.json()) as { key: string }).key : key!;
    const attachments = command.evidence ? [await this.attach(resolved, command.evidence, o.signal)] : undefined;
    return {
      idempotencyKey: command.idempotencyKey,
      ok: true,
      issueUrl: `${this.base}/browse/${resolved}`,
      attachments,
    };
  }
  async attach(key: string, e: EvidenceReference, signal: AbortSignal): Promise<AttachmentResult> {
    try {
      const form = new FormData();
      const source = e.mode === 'data_plane_reference' ? await this.f(e.sessionUrl, { signal }) : await fetch(e.dataUrl, { signal });
      if (!source.ok) return { reference: e, ok: false, error: { code: 'attachment_fetch_failed', message: String(source.status) } };
      form.append('file', await source.blob(), e.mode === 'data_plane_reference' ? new URL(e.sessionUrl).pathname.split('/').pop() || 'evidence' : e.filename);
      const r = await this.f(
        `${this.base}/rest/api/3/issue/${encodeURIComponent(key)}/attachments`,
        {
          method: 'POST',
          headers: { ...this.h(), 'X-Atlassian-Token': 'no-check' },
          body: form,
          signal,
        },
      );
      return r.ok
        ? { reference: e, ok: true }
        : {
            reference: e,
            ok: false,
            error: { code: 'attachment_upload_failed', message: String(r.status) },
          };
    } catch {
      return {
        reference: e,
        ok: false,
        error: { code: 'attachment_upload_failed', message: 'attachment request failed' },
      };
    }
  }
  async read(op: ReadOperation, options: ConnectorExecutionOptions): Promise<ReadResult> {
    if (op.type === 'search') {
      const u = new URL(`${this.base}/rest/api/3/issue/picker`);
      u.searchParams.set('query', op.query);
      u.searchParams.set('currentJQL', 'project = ' + this.c.projectKey);
      const r = await this.f(u, { headers: this.h(), signal: options.signal });
      if (!r.ok)
        return { ok: false, error: { code: 'jira_request_failed', message: String(r.status) } };
      const d = (await r.json()) as {
        sections?: { issues?: { key: string; summaryText: string }[] }[];
      };
      return {
        ok: true,
        issues: (d.sections ?? [])
          .flatMap((s) => s.issues ?? [])
          .slice(0, 10)
          .map((i) => ({ id: i.key, title: i.summaryText, url: `${this.base}/browse/${i.key}` })),
      };
    }
    const r = await this.f(
      `${this.base}/rest/api/3/issue/${encodeURIComponent(op.id)}?fields=summary,status,project`,
      { headers: this.h(), signal: options.signal },
    );
    if (!r.ok)
      return { ok: false, error: { code: 'jira_request_failed', message: String(r.status) } };
    const d = (await r.json()) as {
      key: string;
      fields: { summary: string; status?: { name: string }; project: { key: string } };
    };
    if (d.fields.project.key !== this.c.projectKey)
      return {
        ok: false,
        error: {
          code: 'issue_outside_project',
          message: 'issue is outside configured Jira project',
        },
      };
    return {
      ok: true,
      issue: {
        id: d.key,
        title: d.fields.summary,
        url: `${this.base}/browse/${d.key}`,
        status: d.fields.status?.name,
      },
    };
  }
}
