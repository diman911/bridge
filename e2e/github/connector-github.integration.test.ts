import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectorAttachment, ReadOperation } from '@fairlead/bridge-core';
import { GithubConnector } from '../../packages/connector-github/src/index.js';

const token = process.env.BRIDGE_E2E_GITHUB_TOKEN;
const owner = process.env.BRIDGE_E2E_GITHUB_OWNER;
const repo = process.env.BRIDGE_E2E_GITHUB_REPO;

const enabled = Boolean(token && owner && repo);
const api = 'https://api.github.com';

function headers(json = false): HeadersInit {
  return {
    Authorization: `Bearer ${token ?? ''}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'fairlead-bridge-e2e',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

function repositoryPath(path: string): string {
  return `${api}/repos/${encodeURIComponent(owner ?? '')}/${encodeURIComponent(repo ?? '')}${path}`;
}

async function githubJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(repositoryPath(path), {
    ...init,
    headers: { ...headers(Boolean(init?.body)), ...init?.headers },
  });
  const body = await response.text();
  if (!response.ok)
    throw new Error(`GitHub ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
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

suite('GitHub connector → real GitHub API', () => {
  let connector: GithubConnector;
  let issueNumber: string;
  let issueTitle: string;
  let attachmentBranch: string;
  let attachmentFilename: string;

  beforeAll(async () => {
    connector = new GithubConnector({
      token: token!,
      owner: owner!,
      repo: repo!,
    });
    issueTitle = `Fairlead connector E2E ${crypto.randomUUID()}`;
    attachmentBranch = `fairlead-e2e-${crypto.randomUUID()}`;
    attachmentFilename = `evidence-${crypto.randomUUID()}.txt`;

    const result = await connector.execute(
      {
        protocolVersion: 1,
        type: 'create_issue',
        subject: issueTitle,
        description: 'Created by the direct GitHub connector integration suite.',
      },
      { signal: new AbortController().signal },
    );
    expect(result.ok).toBe(true);
    issueNumber = result.issueId!;
  }, 30_000);

  afterAll(async () => {
    if (!issueNumber) return;
    await fetch(repositoryPath(`/issues/${issueNumber}`), {
      method: 'PATCH',
      headers: headers(true),
      body: JSON.stringify({ state: 'closed' }),
    });
    await fetch(repositoryPath(`/git/refs/heads/${encodeURIComponent(attachmentBranch)}`), {
      method: 'DELETE',
      headers: headers(),
    });
  }, 30_000);

  it('creates an issue through the Issues API', () => {
    expect(issueNumber).toMatch(/^\d+$/);
  });

  it('checks a valid credential through GET /user', async () => {
    await expect(connector.checkCredential()).resolves.toBe(true);
  });

  it('updates title and description through the Issues API', async () => {
    const result = await connector.execute(
      {
        protocolVersion: 1,
        type: 'update_issue',
        issueId: issueNumber,
        subject: `${issueTitle} updated`,
        description: 'Updated by the direct GitHub connector integration suite.',
      },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({ ok: true, issueId: issueNumber });
    const issue = await githubJson<{ title: string; body: string }>(`/issues/${issueNumber}`);
    expect(issue).toMatchObject({
      title: `${issueTitle} updated`,
      body: 'Updated by the direct GitHub connector integration suite.',
    });
  });

  it('fetches and searches issues through the read contract', async () => {
    const fetchResult = await connector.read!(
      { type: 'fetch', connectorId: 'github', id: issueNumber } satisfies ReadOperation,
      { signal: new AbortController().signal },
    );
    expect(fetchResult).toMatchObject({
      ok: true,
      issue: { id: issueNumber, title: `${issueTitle} updated`, status: 'open' },
    });

    const searchResult = await eventually(
      () =>
        connector.read!(
          { type: 'search', connectorId: 'github', query: issueTitle } satisfies ReadOperation,
          { signal: new AbortController().signal },
        ),
      (result) => Boolean(result.ok && result.issues?.some((issue) => issue.id === issueNumber)),
    );
    expect(searchResult).toMatchObject({ ok: true });
    expect(searchResult.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: issueNumber })]),
    );
  });

  it('creates a branch, replaces a file, and places file and image links in the issue body', async () => {
    connector = new GithubConnector({
      token: token!,
      owner: owner!,
      repo: repo!,
      attachmentBranch,
    });
    const makeAttachment = (content: string): ConnectorAttachment => ({
      protocolVersion: 1,
      issueId: issueNumber,
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

    const screenshotFilename = `screenshot-${crypto.randomUUID()}.png`;
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=',
      ),
      (character) => character.charCodeAt(0),
    );
    await expect(
      connector.attach!(
        {
          protocolVersion: 1,
          issueId: issueNumber,
          filename: screenshotFilename,
          contentType: 'image/png',
          data: new Blob([png]).stream(),
          limitState: { exceeded: false, actualBytes: png.length },
        },
        { signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({ filename: screenshotFilename, ok: true });

    const issue = await githubJson<{ body: string }>(`/issues/${issueNumber}`);
    expect(issue.body).toContain('Updated by the direct GitHub connector integration suite.');
    expect(issue.body.match(new RegExp(`\\[${attachmentFilename}\\]`, 'g'))).toHaveLength(1);
    expect(issue.body).toContain(
      `https://github.com/${owner}/${repo}/raw/${attachmentBranch}/attachments/${issueNumber}/${attachmentFilename}`,
    );
    expect(issue.body).toContain(
      `![${screenshotFilename}](https://github.com/${owner}/${repo}/raw/${attachmentBranch}/attachments/${issueNumber}/${screenshotFilename})`,
    );
    const comments = await githubJson<unknown[]>(`/issues/${issueNumber}/comments`);
    expect(comments).toHaveLength(0);

    const file = await githubJson<{ content: string }>(
      `/contents/attachments/${encodeURIComponent(issueNumber)}/${encodeURIComponent(attachmentFilename)}?ref=${encodeURIComponent(attachmentBranch)}`,
    );
    expect(atob(file.content.replace(/\n/g, ''))).toBe('replacement version');
  });

  it('returns false for an invalid credential', async () => {
    const invalid = new GithubConnector({
      token: `${token!}-invalid`,
      owner: owner!,
      repo: repo!,
    });
    await expect(invalid.checkCredential()).resolves.toBe(false);
  });
});
