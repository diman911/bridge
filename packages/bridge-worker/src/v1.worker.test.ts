import { describe, expect, it, vi } from 'vitest';
import { JiraConnector } from '@fairlead/connector-jira';
import type { ConnectorCommand } from '@fairlead/bridge-core';
import { createEnvelopeBridgeWorker } from './v1.js';

describe('Bridge Worker in the Workers runtime', () => {
  it('executes a create_issue command through a connector and Control Plane binding', async () => {
    const nativeFetch = function (this: unknown, input: string | URL) {
      expect(this).toBe(globalThis);
      expect(String(input)).toBe('https://example.atlassian.net/rest/api/3/issue');
      return Promise.resolve(Response.json({ key: 'APP-1' }));
    } as typeof fetch;
    vi.stubGlobal('fetch', nativeFetch);

    try {
      const worker = createEnvelopeBridgeWorker({
        connectors: new Map([
          [
            'jira_cloud',
            (context) =>
              new JiraConnector({
                baseUrl: context.connector.account_url!,
                projectKey: context.connector.container_key!,
                token: context.credential.token,
              }),
          ],
        ]),
      });
      const body: ConnectorCommand & {
        protocolVersion: 1;
        project_id: string;
        integration_instance_id: string;
      } = {
        protocolVersion: 1,
        project_id: 'project-1',
        integration_instance_id: 'instance-1',
        type: 'create_issue',
        subject: 'Title',
        description: 'Description',
      };
      const response = await worker.fetch(
        new Request('https://bridge.test/v1/commands', {
          method: 'POST',
          headers: { authorization: 'Bearer caller' },
          body: JSON.stringify(body),
        }),
        {
          CONTROL_PLANE: {
            resolveBridgeCredential: async () => ({
              credential: { token: 'provider-token', metadata: null, auth_type: 'api_token' },
              connector: {
                catalog_type: 'jira_cloud',
                host: null,
                port: null,
                account_id: null,
                account_url: 'https://example.atlassian.net',
                container_id: null,
                container_key: 'APP',
                container_name: 'App',
              },
            }),
          },
        },
        {} as ExecutionContext,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, issueId: 'APP-1' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
