import {
  PROTOCOL_VERSION,
  mapWithConcurrency,
  mergeHtml,
  type AttachmentResult,
  type Connector,
  type ConnectorCommand,
  type ConnectorExecutionOptions,
  type ReportArtifact,
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
  async execute(c: ConnectorCommand, o: ConnectorExecutionOptions): Promise<IntegrationResult> {
    const fail = (code: string, message: string): IntegrationResult => ({
      idempotencyKey: c.idempotencyKey,
      ok: false,
      error: { code, message },
    });
    const { intent } = c;
    if (intent.action !== 'create_issue' && intent.action !== 'update_issue')
      return fail('unsupported_action', `connector does not support action ${intent.action}`);
    const create = intent.action === 'create_issue';
    const itemUrl = create
      ? undefined
      : `${this.base}/_apis/wit/workitems/${encodeURIComponent(intent.target.id)}?api-version=7.1`;
    let existing = '';
    if (itemUrl) {
      const current = await this.f(`${itemUrl}&fields=System.Description`, {
        headers: { Authorization: this.auth(), Accept: 'application/json' },
        signal: o.signal,
      });
      if (!current.ok) return fail('azure_devops_request_failed', String(current.status));
      existing =
        ((await current.json()) as { fields?: { 'System.Description'?: string } }).fields?.[
          'System.Description'
        ] ?? '';
    }
    const op = create ? 'add' : 'replace';
    const patch = [
      ...(create ? [{ op: 'add', path: '/fields/System.WorkItemType', value: 'Bug' }] : []),
      { op, path: '/fields/System.Title', value: c.title },
      {
        op,
        path: '/fields/System.Description',
        value: mergeHtml(existing, c.description, c.technicalContext),
      },
    ];
    const r = await this.f(itemUrl ?? `${this.base}/_apis/wit/workitems/$Bug?api-version=7.1`, {
      method: create ? 'POST' : 'PATCH',
      headers: this.headers(),
      body: JSON.stringify(patch),
      signal: o.signal,
    });
    if (!r.ok) return fail('azure_devops_request_failed', String(r.status));
    const d = (await r.json()) as { id: number; url: string };
    const attachments = await this.attachAll(
      String(d.id),
      c.artifacts,
      o.attachmentSignal ?? o.signal,
    );
    return {
      idempotencyKey: c.idempotencyKey,
      ok: true,
      issueUrl: this.webUrl(d.id),
      attachments: attachments.length ? attachments : undefined,
    };
  }
  /**
   * Uploads run in parallel; the work item is then linked once, since concurrent
   * PATCHes of one work item can conflict on its revision.
   */
  private async attachAll(
    id: string,
    artifacts: ReportArtifact[],
    signal: AbortSignal,
  ): Promise<AttachmentResult[]> {
    const uploads = await mapWithConcurrency(artifacts, 3, async (artifact) => {
      try {
        const upload = await this.f(
          `${this.base}/_apis/wit/attachments?fileName=${encodeURIComponent(artifact.filename)}&api-version=7.1`,
          {
            method: 'POST',
            headers: { Authorization: this.auth(), 'Content-Type': 'application/octet-stream' },
            body: artifact.data as Uint8Array<ArrayBuffer>,
            signal,
          },
        );
        if (!upload.ok)
          return {
            artifact,
            error: { code: 'attachment_upload_failed', message: String(upload.status) },
          };
        return { artifact, url: ((await upload.json()) as { url: string }).url };
      } catch {
        return {
          artifact,
          error: { code: 'attachment_upload_failed', message: 'attachment request failed' },
        };
      }
    });
    const uploaded = uploads.filter(
      (u): u is { artifact: ReportArtifact; url: string } => 'url' in u,
    );
    let linkError: AttachmentResult['error'];
    if (uploaded.length) {
      try {
        const link = await this.f(
          `${this.base}/_apis/wit/workitems/${encodeURIComponent(id)}?api-version=7.1`,
          {
            method: 'PATCH',
            headers: this.headers(),
            body: JSON.stringify(
              uploaded.map((u) => ({
                op: 'add',
                path: '/relations/-',
                value: {
                  rel: 'AttachedFile',
                  url: u.url,
                  attributes: { comment: u.artifact.filename },
                },
              })),
            ),
            signal,
          },
        );
        if (!link.ok) linkError = { code: 'attachment_link_failed', message: String(link.status) };
      } catch {
        linkError = { code: 'attachment_link_failed', message: 'attachment request failed' };
      }
    }
    return uploads.map((u) =>
      'url' in u
        ? linkError
          ? { filename: u.artifact.filename, ok: false, error: linkError }
          : { filename: u.artifact.filename, ok: true }
        : { filename: u.artifact.filename, ok: false, error: u.error },
    );
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
