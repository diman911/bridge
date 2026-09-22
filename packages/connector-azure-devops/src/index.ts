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

function toHtml(description: string): string {
  return description
    .split(/\n\n+/)
    .filter((paragraph) => paragraph.trim())
    .map(
      (paragraph) =>
        `<p>${paragraph.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
}

export interface AzureDevOpsConnectorConfig {
  token: string;
  organization: string;
  project: string;
  authType?: 'oauth' | 'api_token';
  fetch?: typeof fetch;
}
export class AzureDevOpsConnector implements Connector {
  readonly capabilities: ConnectorCapabilities = {
    protocolVersion: PROTOCOL_VERSION,
    connectorId: 'azure_devops',
    displayName: 'Azure DevOps',
    targets: {
      issue: {
        actions: ['create', 'update'],
        reads: ['fetch', 'search'],
        attachments: true,
      },
    },
  };
  private readonly f: typeof fetch;
  private readonly base: string;
  private readonly organizationBase: string;
  constructor(private readonly c: AzureDevOpsConnectorConfig) {
    this.f = c.fetch ?? fetch;
    this.organizationBase = `https://dev.azure.com/${encodeURIComponent(c.organization)}`;
    this.base = `${this.organizationBase}/${encodeURIComponent(c.project)}`;
  }
  private auth() {
    // Azure DevOps PATs use HTTP Basic with an empty username. OAuth access
    // tokens use Bearer; Control Plane resolves which credential is in use.
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
    const response = await this.f(
      `${this.organizationBase}/_apis/projects?$top=1&api-version=7.1`,
      {
        headers: { Authorization: this.auth(), Accept: 'application/json' },
        redirect: 'manual',
        signal,
      },
    );
    return (
      response.status === 200 && response.headers.get('content-type')?.includes('application/json')
    );
  }
  async execute(c: ConnectorCommand, o: ConnectorExecutionOptions): Promise<IntegrationResult> {
    const fail = (code: string, message: string): IntegrationResult => ({
      ok: false,
      error: { code, message },
    });
    const create = c.type === 'create_issue';
    const itemUrl = create
      ? undefined
      : `${this.base}/_apis/wit/workitems/${encodeURIComponent(c.issueId)}?api-version=7.1`;
    const op = create ? 'add' : 'replace';
    const patch = [
      ...(c.subject === undefined ? [] : [{ op, path: '/fields/System.Title', value: c.subject }]),
      ...(c.description === undefined
        ? []
        : [{ op, path: '/fields/System.Description', value: toHtml(c.description) }]),
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
      ok: true,
      issueId: String(d.id),
      issueUrl: this.webUrl(d.id),
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
    const item = `${this.base}/_apis/wit/workitems/${encodeURIComponent(attachment.issueId)}?api-version=7.1`;
    try {
      const current = await this.f(`${item}&$expand=relations`, {
        headers: { Authorization: this.auth(), Accept: 'application/json' },
        signal: options.signal,
      });
      if (!current.ok) return fail('attachment_lookup_failed', String(current.status));
      const body = (await current.json()) as {
        rev?: number;
        relations?: {
          rel: string;
          url: string;
          attributes?: { name?: string; comment?: string };
        }[];
      };
      const relations = body.relations ?? [];
      const previous = relations
        .map((relation, index) => ({ relation, index }))
        .filter(
          ({ relation }) =>
            relation.rel === 'AttachedFile' &&
            (relation.attributes?.name === attachment.filename ||
              relation.attributes?.comment === attachment.filename),
        );
      const uploadInit: RequestInit & { duplex: 'half' } = {
        method: 'POST',
        headers: { Authorization: this.auth(), 'Content-Type': 'application/octet-stream' },
        body: attachment.data,
        signal: options.signal,
        // Node's fetch requires this flag for a ReadableStream request body.
        duplex: 'half',
      };
      const upload = await this.f(
        `${this.base}/_apis/wit/attachments?fileName=${encodeURIComponent(attachment.filename)}&api-version=7.1`,
        uploadInit,
      );
      if (!upload.ok) return fail('attachment_upload_failed', String(upload.status));
      const uploadedUrl = ((await upload.json()) as { url: string }).url;
      const patch = [
        ...(previous.length && body.rev !== undefined
          ? [{ op: 'test', path: '/rev', value: body.rev }]
          : []),
        ...previous
          .sort((a, b) => b.index - a.index)
          .map(({ index }) => ({ op: 'remove', path: `/relations/${index}` })),
        {
          op: 'add',
          path: '/relations/-',
          value: {
            rel: 'AttachedFile',
            url: uploadedUrl,
            attributes: { comment: attachment.filename },
          },
        },
      ];
      const linked = await this.f(item, {
        method: 'PATCH',
        headers: this.headers(),
        body: JSON.stringify(patch),
        signal: options.signal,
      });
      if (!linked.ok) return fail('attachment_link_failed', String(linked.status));
      const cleanup = await Promise.allSettled(
        previous.map(({ relation }) =>
          this.f(`${relation.url}?api-version=7.1`, {
            method: 'DELETE',
            headers: { Authorization: this.auth() },
            signal: options.signal,
          }),
        ),
      );
      const warning = cleanup.some((result) => result.status === 'rejected' || !result.value.ok);
      return {
        filename: attachment.filename,
        ok: true,
        ...(warning
          ? {
              warnings: [
                {
                  code: 'previous_version_not_removed' as const,
                  message:
                    'the new attachment was linked but an older version could not be deleted',
                },
              ],
            }
          : {}),
      };
    } catch {
      return attachment.limitState.exceeded
        ? fail('attachment_too_large', 'attachment exceeds limit')
        : fail('attachment_upload_failed', 'attachment request failed');
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
