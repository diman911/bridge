import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectorAttachment, ReadOperation } from '@fairlead/bridge-core';
import { JiraConnector } from '../../packages/connector-jira/src/index.js';

const baseUrl = process.env.BRIDGE_E2E_JIRA_BASE_URL?.replace(/\/+$/, '');
const email = process.env.BRIDGE_E2E_JIRA_EMAIL;
const token = process.env.BRIDGE_E2E_JIRA_TOKEN;
const projectKey = process.env.BRIDGE_E2E_JIRA_PROJECT_KEY;

const enabled = Boolean(baseUrl && email && token && projectKey);

function headers(json = false, credential = token): HeadersInit {
  return {
    Authorization: `Basic ${btoa(`${email ?? ''}:${credential ?? ''}`)}`,
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

function jiraUrl(path: string): string {
  return `${baseUrl ?? ''}${path}`;
}

async function jiraJson<T>(path: string, init?: RequestInit, credential = token): Promise<T> {
  const response = await fetch(jiraUrl(path), {
    ...init,
    headers: { ...headers(Boolean(init?.body), credential), ...init?.headers },
  });
  const body = await response.text();
  if (!response.ok)
    throw new Error(`Jira ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
  return body ? (JSON.parse(body) as T) : (undefined as T);
}

async function eventually<T>(operation: () => Promise<T>, predicate: (value: T) => boolean) {
  let last: T | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    last = await operation();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return last as T;
}

const suite = describe.skipIf(!enabled);

suite('Jira connector → real Jira Cloud API', () => {
  let connector: JiraConnector;
  let issueKey: string;
  let issueTitle: string;
  let attachmentFilename: string;

  beforeAll(async () => {
    connector = new JiraConnector({
      baseUrl: baseUrl!,
      email: email!,
      token: token!,
      authType: 'api_token',
      projectKey: projectKey!,
    });
    issueTitle = `Fairlead connector E2E ${crypto.randomUUID()}`;
    attachmentFilename = `evidence-${crypto.randomUUID()}.txt`;

    const result = await connector.execute(
      {
        protocolVersion: 1,
        type: 'create_issue',
        subject: issueTitle,
        description: 'Created by the Jira Cloud connector integration suite.',
      },
      { signal: new AbortController().signal },
    );
    expect(result.ok).toBe(true);
    issueKey = result.issueId!;
  }, 30_000);

  afterAll(async () => {
    if (!issueKey) return;
    await fetch(jiraUrl(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`), {
      method: 'DELETE',
      headers: headers(),
    });
  }, 30_000);

  it('creates an issue through the v3 REST API', () => {
    expect(issueKey).toMatch(/^[A-Z][A-Z0-9_]*-\d+$/);
  });

  it('checks a valid credential through GET /myself', async () => {
    await expect(connector.checkCredential()).resolves.toBe(true);
  });

  it('updates summary and ADF description through the v3 REST API', async () => {
    const updatedTitle = `${issueTitle} updated`;
    const result = await connector.execute(
      {
        protocolVersion: 1,
        type: 'update_issue',
        issueId: issueKey,
        subject: updatedTitle,
        description: 'Updated by the Jira Cloud connector integration suite.',
      },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({ ok: true, issueId: issueKey });
    const issue = await jiraJson<{
      fields: { summary: string; description: { content?: { content?: { text?: string }[] }[] } };
    }>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,description`);
    expect(issue.fields.summary).toBe(updatedTitle);
    expect(issue.fields.description.content?.[0]?.content?.[0]?.text).toBe(
      'Updated by the Jira Cloud connector integration suite.',
    );
  });

  it('fetches and searches issues through the read contract', async () => {
    const fetchResult = await connector.read!(
      { type: 'fetch', connectorId: 'jira', id: issueKey } satisfies ReadOperation,
      { signal: new AbortController().signal },
    );
    expect(fetchResult).toMatchObject({
      ok: true,
      issue: { id: issueKey, title: `${issueTitle} updated` },
    });

    const searchResult = await eventually(
      () =>
        connector.read!(
          { type: 'search', connectorId: 'jira', query: issueTitle } satisfies ReadOperation,
          { signal: new AbortController().signal },
        ),
      (result) => Boolean(result.ok && result.issues?.some((issue) => issue.id === issueKey)),
    );
    expect(searchResult).toMatchObject({ ok: true });
    expect(searchResult.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: issueKey })]),
    );
  });

  it('uploads a native attachment, replaces it, and removes the previous version', async () => {
    const makeAttachment = (content: string): ConnectorAttachment => ({
      protocolVersion: 1,
      issueId: issueKey,
      filename: attachmentFilename,
      contentType: 'text/plain',
      data: new Blob([content]).stream(),
      limitState: { exceeded: false, actualBytes: content.length },
    });

    const first = await connector.attach!(makeAttachment('first version'), {
      signal: new AbortController().signal,
    });
    expect(first).toEqual({ filename: attachmentFilename, ok: true });

    await expect(
      connector.attach!(makeAttachment('replacement version'), {
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ filename: attachmentFilename, ok: true });

    const issue = await jiraJson<{
      fields: { attachment: { id: string; filename: string; content: string }[] };
    }>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=attachment`);
    const attachments = issue.fields.attachment.filter(
      (attachment) => attachment.filename === attachmentFilename,
    );
    expect(attachments).toHaveLength(1);
    const content = await fetch(attachments[0].content, { headers: headers() });
    expect(content.ok).toBe(true);
    expect(await content.text()).toBe('replacement version');
  });

  it('returns false for an invalid credential', async () => {
    const invalid = new JiraConnector({
      baseUrl: baseUrl!,
      email: email!,
      token: `${token!}-invalid`,
      authType: 'api_token',
      projectKey: projectKey!,
    });
    await expect(invalid.checkCredential()).resolves.toBe(false);
  });
});
