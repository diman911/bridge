import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bridgeUrl, startGithubE2e, type GithubE2eServers } from './fixtures.js';

const token = process.env.BRIDGE_E2E_GITHUB_TOKEN;
const owner = process.env.BRIDGE_E2E_GITHUB_OWNER;
const repo = process.env.BRIDGE_E2E_GITHUB_REPO;

describe.skipIf(!token || !owner || !repo)('e2e: local Bridge + local CP + real GitHub', () => {
  let servers: GithubE2eServers;
  let issueNumber: number | undefined;

  beforeAll(async () => {
    servers = await startGithubE2e();
  }, 120_000);

  afterAll(async () => {
    if (issueNumber !== undefined) {
      await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state: 'closed' }),
      });
    }
    await servers?.stop();
  }, 30_000);

  it('resolves config and credential through CP, then creates an issue in GitHub', async () => {
    const suffix = crypto.randomUUID();
    const title = `Fairlead Bridge E2E ${suffix}`;
    const description = `Created by local Bridge E2E ${suffix}`;
    const response = await fetch(`${bridgeUrl}/v1/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${servers.seed.bridgeIdentityToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        protocolVersion: 1,
        type: 'create_issue',
        project_id: servers.seed.projectId,
        integration_instance_id: servers.seed.githubIntegrationInstanceId,
        subject: title,
        description,
      }),
    });

    const responseText = await response.text();
    expect(response.status, `${responseText}\n${servers.diagnostics()}`).toBe(200);
    const result = JSON.parse(responseText) as { ok: boolean; issueUrl?: string };
    expect(result.ok).toBe(true);
    expect(result.issueUrl).toMatch(
      new RegExp(`^https://github\\.com/${owner}/${repo}/issues/\\d+$`),
    );

    const issueUrl = new URL(result.issueUrl!);
    issueNumber = Number(issueUrl.pathname.split('/').pop());
    const githubResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      },
    );
    expect(githubResponse.status).toBe(200);
    await expect(githubResponse.json()).resolves.toMatchObject({
      number: issueNumber,
      title,
      body: description,
      repository_url: `https://api.github.com/repos/${owner}/${repo}`,
    });
  });
});
