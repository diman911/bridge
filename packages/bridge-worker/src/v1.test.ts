import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type Connector } from '@fairlead/bridge-core';
import { createEnvelopeBridgeWorker } from './v1.js';

const contract = join(dirname(fileURLToPath(import.meta.url)), '../../bridge-core/contract/v1');
const connector: Connector = {
  capabilities: {
    protocolVersion: PROTOCOL_VERSION,
    connectorId: 'fixture',
    displayName: 'Fixture',
    supportedTargets: ['issue'],
    supportedActions: ['create_issue', 'update_issue'],
    verdictMappings: {},
  },
  execute: async (command) => ({
    idempotencyKey: command.idempotencyKey,
    ok: true,
    issueUrl: 'https://tracker.example.test/browse/APP-43',
  }),
};
const worker = createEnvelopeBridgeWorker({ connectors: new Map([['fixture', () => connector]]) });
const env = {
  CONTROL_PLANE: {
    resolveBridgeCredential: async () => ({
      caller_id: 'user-123',
      credential: { token: 'provider-token', metadata: null, auth_type: 'oauth' as const },
      connector: {
        catalog_type: 'fixture',
        host: null,
        port: null,
        account_id: null,
        account_url: null,
        container_id: null,
        container_key: null,
        container_name: null,
      },
    }),
  },
};

describe('v1 frozen contract fixtures', () => {
  it('replays every v1 request fixture through the Worker', async () => {
    const files = (await readdir(contract)).filter((name) => /^request-.*\.json$/.test(name));
    for (const name of files) {
      const body = await readFile(join(contract, name), 'utf8');
      const response = await worker.fetch(
        new Request('https://bridge.example.test/v1/commands', {
          method: 'POST',
          headers: { authorization: 'Bearer fairlead-token' },
          body,
        }),
        env,
        {} as ExecutionContext,
      );
      expect(response.status, name).toBe(200);
      expect(await response.json(), name).toMatchObject({ ok: true });
    }
  });

  it('rejects a body that exceeds the envelope ceiling before JSON parsing', async () => {
    const response = await worker.fetch(
      new Request('https://bridge.example.test/v1/commands', {
        method: 'POST',
        headers: {
          authorization: 'Bearer fairlead-token',
          'content-length': String(11 * 1024 * 1024),
        },
        body: '{}',
      }),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(413);
  });
});
