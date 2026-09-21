import {
  PROTOCOL_VERSION,
  type AttachmentResult,
  type Connector,
  type ConnectorExecutionOptions,
  type EvidenceReference,
  type IntegrationCommand,
  type IntegrationResult,
  type ReadOperation,
  type ReadResult,
} from '@fairlead/bridge-core';
export interface AzureDevOpsConnectorConfig {
  token: string;
  organization: string;
  project: string;
  authType?: 'oauth' | 'api_token';
  fetch?: typeof fetch;
}
export class AzureDevOpsConnector implements Connector {
  readonly capabilities = {
    protocolVersion: PROTOCOL_VERSION,
    connectorId: 'azure_devops',
    displayName: 'Azure DevOps',
    supportedTargets: ['issue'] as 'issue'[],
    supportedActions: ['create_issue', 'update_issue'] as ('create_issue' | 'update_issue')[],
    verdictMappings: {},
  };
  private readonly f: typeof fetch;
  private readonly base: string;
  constructor(private readonly c: AzureDevOpsConnectorConfig) {
    this.f = c.fetch ?? fetch;
    this.base = `https://dev.azure.com/${encodeURIComponent(c.organization)}/${encodeURIComponent(c.project)}`;
  }
  private auth() {
    return this.c.authType === 'api_token'
      ? `Basic ${btoa(`:${this.c.token}`)}`
      : `Bearer ${this.c.token}`;
  }
  private headers() {
    return {
      Authorization: this.auth(),
      'Content-Type': 'application/json-patch+json',
      Accept: 'application/json',
    };
  }
  private webUrl(id: number | string) {
    return `${this.base}/_workitems/edit/${encodeURIComponent(String(id))}`;
  }
  async checkCredential(signal?: AbortSignal) {
    return (
      await this.f('https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1', {
        headers: { Authorization: this.auth() },
        signal,
      })
    ).ok;
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
    const patch = [
      ...(a.type === 'create_issue'
        ? [{ op: 'add', path: '/fields/System.WorkItemType', value: 'Bug' }]
        : []),
      {
        op: a.type === 'create_issue' ? 'add' : 'replace',
        path: '/fields/System.Title',
        value: c.title,
      },
      {
        op: a.type === 'create_issue' ? 'add' : 'replace',
        path: '/fields/System.Description',
        value: c.description,
      },
    ];
    const r = await this.f(
      a.type === 'create_issue'
        ? `${this.base}/_apis/wit/workitems/$Bug?api-version=7.1`
        : `${this.base}/_apis/wit/workitems/${encodeURIComponent(id!)}?api-version=7.1`,
      {
        method: a.type === 'create_issue' ? 'POST' : 'PATCH',
        headers: this.headers(),
        body: JSON.stringify(patch),
        signal: o.signal,
      },
    );
    if (!r.ok)
      return {
        idempotencyKey: c.idempotencyKey,
        ok: false,
        error: { code: 'azure_devops_request_failed', message: String(r.status) },
      };
    const d = (await r.json()) as { id: number; url: string };
    const attachments = c.evidence
      ? [await this.attach(String(d.id), c.evidence, o.signal)]
      : undefined;
    return { idempotencyKey: c.idempotencyKey, ok: true, issueUrl: this.webUrl(d.id), attachments };
  }
  private async attach(
    id: string,
    e: EvidenceReference,
    signal: AbortSignal,
  ): Promise<AttachmentResult> {
    try {
      const source =
        e.mode === 'data_plane_reference'
          ? await this.f(e.sessionUrl, { signal })
          : await fetch(e.dataUrl, { signal });
      if (!source.ok)
        return {
          reference: e,
          ok: false,
          error: { code: 'attachment_fetch_failed', message: String(source.status) },
        };
      const name =
        e.mode === 'data_plane_reference'
          ? new URL(e.sessionUrl).pathname.split('/').pop() || 'evidence'
          : e.filename;
      const upload = await this.f(
        `${this.base}/_apis/wit/attachments?fileName=${encodeURIComponent(name)}&api-version=7.1`,
        {
          method: 'POST',
          headers: { Authorization: this.auth(), 'Content-Type': 'application/octet-stream' },
          body: await source.arrayBuffer(),
          signal,
        },
      );
      if (!upload.ok)
        return {
          reference: e,
          ok: false,
          error: { code: 'attachment_upload_failed', message: String(upload.status) },
        };
      const u = (await upload.json()) as { url: string };
      const link = await this.f(
        `${this.base}/_apis/wit/workitems/${encodeURIComponent(id)}?api-version=7.1`,
        {
          method: 'PATCH',
          headers: this.headers(),
          body: JSON.stringify([
            {
              op: 'add',
              path: '/relations/-',
              value: { rel: 'AttachedFile', url: u.url, attributes: { comment: name } },
            },
          ]),
          signal,
        },
      );
      return link.ok
        ? { reference: e, ok: true }
        : {
            reference: e,
            ok: false,
            error: { code: 'attachment_link_failed', message: String(link.status) },
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
    if (op.type === 'fetch') {
      const r = await this.f(
        `${this.base}/_apis/wit/workitems/${encodeURIComponent(op.id)}?api-version=7.1`,
        { headers: { Authorization: this.auth() }, signal: options.signal },
      );
      if (!r.ok)
        return {
          ok: false,
          error: { code: 'azure_devops_request_failed', message: String(r.status) },
        };
      const d = (await r.json()) as {
        id: number;
        url: string;
        fields: { 'System.Title': string; 'System.State'?: string };
      };
      return {
        ok: true,
        issue: {
          id: String(d.id),
          title: d.fields['System.Title'],
          url: this.webUrl(d.id),
          status: d.fields['System.State'],
        },
      };
    }
    const q = op.query.replace(/'/g, "''");
    const wiql = await this.f(`${this.base}/_apis/wit/wiql?api-version=7.1`, {
      method: 'POST',
      headers: {
        Authorization: this.auth(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Title] CONTAINS '${q}'`,
      }),
      signal: options.signal,
    });
    if (!wiql.ok)
      return {
        ok: false,
        error: { code: 'azure_devops_request_failed', message: String(wiql.status) },
      };
    const ids = ((await wiql.json()) as { workItems?: { id: number }[] }).workItems
      ?.slice(0, 10)
      .map((x) => x.id)
      .join(',');
    if (!ids) return { ok: true, issues: [] };
    const r = await this.f(
      `${this.base}/_apis/wit/workitems?ids=${ids}&fields=System.Title,System.State&api-version=7.1`,
      { headers: { Authorization: this.auth() }, signal: options.signal },
    );
    if (!r.ok)
      return {
        ok: false,
        error: { code: 'azure_devops_request_failed', message: String(r.status) },
      };
    const d = (await r.json()) as {
      value: {
        id: number;
        url: string;
        fields: { 'System.Title': string; 'System.State'?: string };
      }[];
    };
    return {
      ok: true,
      issues: d.value.map((x) => ({
        id: String(x.id),
        title: x.fields['System.Title'],
        url: this.webUrl(x.id),
        status: x.fields['System.State'],
      })),
    };
  }
}
