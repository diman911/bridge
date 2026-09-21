import {
  PROTOCOL_VERSION,
  mergeAdf,
  type Connector,
  type ConnectorCommand,
  type ConnectorExecutionOptions,
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
    command: ConnectorCommand,
    o: ConnectorExecutionOptions,
  ): Promise<IntegrationResult> {
    const fail = (code: string, message: string): IntegrationResult => ({
      idempotencyKey: command.idempotencyKey,
      ok: false,
      error: { code, message },
    });
    const { type } = command;
    let key: string;
    if (type === 'create_issue') {
      const r = await this.f(`${this.base}/rest/api/3/issue`, {
        method: 'POST',
        headers: this.h(true),
        body: JSON.stringify({
          fields: {
            project: { key: this.c.projectKey },
            summary: command.subject,
            description: mergeAdf(null, command.description, command.technicalSection ?? ''),
            issuetype: { name: 'Bug' },
          },
        }),
        signal: o.signal,
      });
      if (!r.ok) return fail('jira_request_failed', `${r.status} ${r.statusText}`);
      key = ((await r.json()) as { key: string }).key;
    } else {
      key = command.issueId;
      const url = `${this.base}/rest/api/3/issue/${encodeURIComponent(key)}`;
      const current = await this.f(`${url}?fields=description,project`, {
        headers: this.h(),
        signal: o.signal,
      });
      if (!current.ok)
        return fail('jira_request_failed', `${current.status} ${current.statusText}`);
      const existing = (await current.json()) as {
        fields?: { description?: unknown; project?: { key?: string } };
      };
      if (existing.fields?.project?.key !== this.c.projectKey)
        return fail('issue_outside_project', 'issue is outside configured Jira project');
      const r = await this.f(url, {
        method: 'PUT',
        headers: this.h(true),
        body: JSON.stringify({
          fields: {
            ...(command.subject === undefined ? {} : { summary: command.subject }),
            description: mergeAdf(
              existing.fields?.description,
              command.description ?? '',
              command.technicalSection ?? '',
            ),
          },
        }),
        signal: o.signal,
      });
      if (!r.ok) return fail('jira_request_failed', `${r.status} ${r.statusText}`);
    }
    return {
      idempotencyKey: command.idempotencyKey,
      ok: true,
      issueUrl: `${this.base}/browse/${key}`,
    };
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
