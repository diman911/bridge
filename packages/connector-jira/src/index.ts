import {
  PROTOCOL_VERSION,
  type Connector,
  type ConnectorCapabilities,
  type ConnectorCommand,
  type ConnectorExecutionOptions,
  type IntegrationResult,
  type ConnectorAttachment,
  type ConnectorAttachmentOptions,
  type AttachmentResult,
  type ReadOperation,
  type ReadResult,
} from '@fairlead/bridge-core';

function toAdf(description: string) {
  const paragraphs = description.replace(/\r\n?/g, '\n').split(/\n\n+/);
  return {
    version: 1 as const,
    type: 'doc',
    content: paragraphs
      .filter((paragraph) => paragraph.trim())
      .map((paragraph) => ({
        type: 'paragraph',
        content: paragraph.split('\n').flatMap((line, index) => [
          ...(index === 0 ? [] : [{ type: 'hardBreak' }]),
          ...(line ? [{ type: 'text', text: line }] : []),
        ]),
      })),
  };
}
export interface JiraConnectorConfig {
  baseUrl: string;
  /** Atlassian cloud ID required by gateway-backed Jira credentials. */
  cloudId?: string;
  token: string;
  projectKey: string;
  authType?: 'oauth' | 'api_token' | 'scoped_api_token';
  email?: string;
  fetch?: typeof fetch;
}
export class JiraConnector implements Connector {
  readonly capabilities: ConnectorCapabilities = {
    protocolVersion: PROTOCOL_VERSION,
    connectorId: 'jira',
    displayName: 'Jira Cloud',
    targets: {
      issue: {
        actions: ['create', 'update'],
        reads: ['fetch', 'search'],
        attachments: true,
      },
    },
  };
  private base;
  private f;
  constructor(private c: JiraConnectorConfig) {
    if ((c.authType === 'oauth' || c.authType === 'scoped_api_token') && !c.cloudId?.trim())
      throw new Error(`Jira ${c.authType === 'oauth' ? 'OAuth' : 'scoped API token'} configuration requires cloudId`);
    if (c.authType === 'scoped_api_token' && !c.email?.trim())
      throw new Error('Jira scoped API token configuration requires email');
    this.base =
      c.authType === 'oauth' || c.authType === 'scoped_api_token'
        ? `https://api.atlassian.com/ex/jira/${encodeURIComponent(c.cloudId!.trim())}`
        : c.baseUrl.replace(/\/+$/, '');
    this.f = c.fetch ?? fetch;
  }
  private h(json = false) {
    const authorization =
      (this.c.authType === 'api_token' || this.c.authType === 'scoped_api_token') && this.c.email
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
            description: toAdf(command.description),
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
      const current = await this.f(`${url}?fields=project`, {
        headers: this.h(),
        signal: o.signal,
      });
      if (!current.ok)
        return fail('jira_request_failed', `${current.status} ${current.statusText}`);
      const existing = (await current.json()) as {
        fields?: { project?: { key?: string } };
      };
      if (existing.fields?.project?.key !== this.c.projectKey)
        return fail('issue_outside_project', 'issue is outside configured Jira project');
      const r = await this.f(url, {
        method: 'PUT',
        headers: this.h(true),
        body: JSON.stringify({
          fields: {
            ...(command.subject === undefined ? {} : { summary: command.subject }),
            ...(command.description === undefined
              ? {}
              : { description: toAdf(command.description) }),
          },
        }),
        signal: o.signal,
      });
      if (!r.ok) return fail('jira_request_failed', `${r.status} ${r.statusText}`);
    }
    return {
      ok: true,
      issueId: key,
      issueUrl: `${this.base}/browse/${key}`,
    };
  }
  async attach(
    attachment: ConnectorAttachment,
    options: ConnectorAttachmentOptions,
  ): Promise<AttachmentResult> {
    const issue = `${this.base}/rest/api/3/issue/${encodeURIComponent(attachment.issueId)}`;
    try {
      const current = await this.f(`${issue}?fields=attachment,project`, {
        headers: this.h(),
        signal: options.signal,
      });
      if (!current.ok)
        return this.attachmentFailure(
          attachment,
          'attachment_lookup_failed',
          String(current.status),
        );
      const existing = (await current.json()) as {
        fields?: { project?: { key?: string }; attachment?: { id: string; filename: string }[] };
      };
      if (existing.fields?.project?.key !== this.c.projectKey)
        return this.attachmentFailure(
          attachment,
          'issue_outside_project',
          'issue is outside configured Jira project',
        );
      const storedName = attachment.filename.replace(/["\r\n]/g, '_');
      const previous = (existing.fields?.attachment ?? []).filter(
        (item) => item.filename === attachment.filename || item.filename === storedName,
      );
      const boundary = `fairlead-${crypto.randomUUID()}`;
      const prefix = new TextEncoder().encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${storedName}"\r\nContent-Type: ${attachment.contentType}\r\n\r\n`,
      );
      const suffix = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
      const fileReader = attachment.data.getReader();
      let sentPrefix = false;
      let sentSuffix = false;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (!sentPrefix) {
            sentPrefix = true;
            controller.enqueue(prefix);
            return;
          }
          const next = await fileReader.read();
          if (!next.done) {
            controller.enqueue(next.value);
            return;
          }
          if (!sentSuffix) {
            sentSuffix = true;
            controller.enqueue(suffix);
            return;
          }
          controller.close();
        },
        async cancel(reason) {
          await fileReader.cancel(reason);
        },
      });
      const uploadInit: RequestInit & { duplex: 'half' } = {
        method: 'POST',
        headers: {
          ...this.h(),
          'X-Atlassian-Token': 'no-check',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        signal: options.signal,
        // Node's fetch requires this flag for a ReadableStream request body.
        duplex: 'half',
      };
      const upload = await this.f(`${issue}/attachments`, uploadInit);
      if (!upload.ok)
        return this.attachmentFailure(
          attachment,
          'attachment_upload_failed',
          String(upload.status),
        );
      const cleanup = await Promise.allSettled(
        previous.map((item) =>
          this.f(`${this.base}/rest/api/3/attachment/${encodeURIComponent(item.id)}`, {
            method: 'DELETE',
            headers: this.h(),
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
                    'the new attachment was uploaded but an older version could not be removed',
                },
              ],
            }
          : {}),
      };
    } catch {
      return attachment.limitState.exceeded
        ? this.attachmentFailure(attachment, 'attachment_too_large', 'attachment exceeds limit')
        : this.attachmentFailure(
            attachment,
            'attachment_upload_failed',
            'attachment request failed',
          );
    }
  }
  private attachmentFailure(
    attachment: ConnectorAttachment,
    code: string,
    message: string,
  ): AttachmentResult {
    return { filename: attachment.filename, ok: false, error: { code, message } };
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
