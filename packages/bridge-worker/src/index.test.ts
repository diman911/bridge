import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';

const connector = {
  catalog_type: 'jira_cloud',
  host: null,
  port: null,
  account_id: 'cloud-1',
  account_url: 'https://example.atlassian.net',
  container_id: '10001',
  container_key: 'APP',
  container_name: 'Example App',
};

afterEach(() => vi.unstubAllGlobals());

describe('production Jira Cloud factory', () => {
  it('passes Control Plane cloud_id to Jira OAuth and uses the Atlassian gateway', async () => {
    const providerFetch = vi.fn(async () => Response.json({ key: 'APP-1' }));
    vi.stubGlobal('fetch', providerFetch);

    const response = await worker.fetch(
      new Request('https://bridge.example.test/v1/commands', {
        method: 'POST',
        headers: { authorization: 'Bearer fairlead-token' },
        body: JSON.stringify({
          protocolVersion: 1,
          project_id: 'project-1',
          integration_instance_id: 'instance-1',
          type: 'create_issue',
          subject: 'Title',
          description: 'Description',
        }),
      }),
      {
        CONTROL_PLANE: {
          resolveBridgeCredential: async () => ({
            credential: {
              token: 'oauth-access-token',
              metadata: { email: 'must-not-be-used@example.test' },
              auth_type: 'oauth' as const,
              cloud_id: 'cloud id',
            },
            connector,
          }),
        },
      },
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(providerFetch).toHaveBeenCalledWith(
      'https://api.atlassian.com/ex/jira/cloud%20id/rest/api/3/issue',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer oauth-access-token' }),
      }),
    );
  });

  it('reports missing OAuth cloud_id as an incomplete connector configuration', async () => {
    const response = await worker.fetch(
      new Request('https://bridge.example.test/v1/commands', {
        method: 'POST',
        headers: { authorization: 'Bearer fairlead-token' },
        body: JSON.stringify({
          protocolVersion: 1,
          project_id: 'project-1',
          integration_instance_id: 'instance-1',
          type: 'create_issue',
          subject: 'Title',
          description: 'Description',
        }),
      }),
      {
        CONTROL_PLANE: {
          resolveBridgeCredential: async () => ({
            credential: { token: 'oauth-access-token', metadata: null, auth_type: 'oauth' as const },
            connector,
          }),
        },
      },
      {} as ExecutionContext,
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'connector_not_configured' } });
  });
});
