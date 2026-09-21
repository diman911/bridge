import {
  PROTOCOL_VERSION,
  mergeHtml,
  type Connector,
  type ConnectorCommand,
  type ConnectorExecutionOptions,
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
    const create = c.type === 'create_issue';
    const itemUrl = create
      ? undefined
      : `${this.base}/_apis/wit/workitems/${encodeURIComponent(c.issueId)}?api-version=7.1`;
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
      ...(c.subject === undefined ? [] : [{ op, path: '/fields/System.Title', value: c.subject }]),
      {
        op,
        path: '/fields/System.Description',
        value: mergeHtml(existing, c.description ?? '', c.technicalSection ?? ''),
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
    return {
      idempotencyKey: c.idempotencyKey,
      ok: true,
      issueUrl: this.webUrl(d.id),
    };
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
