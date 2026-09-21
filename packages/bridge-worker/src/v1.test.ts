import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAX_JSON_REQUEST_BYTES,
  PROTOCOL_VERSION,
  type Connector,
  type ConnectorCommand,
} from '@fairlead/bridge-core';
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

  it('rejects an oversized declared body before reading it', async () => {
    const response = await worker.fetch(
      new Request('https://bridge.example.test/v1/commands', {
        method: 'POST',
        headers: {
          authorization: 'Bearer fairlead-token',
          'content-length': String(MAX_JSON_REQUEST_BYTES + 1),
        },
        body: '{}',
      }),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'request_too_large' } });
  });

  it('stops reading an oversized chunked body before JSON parsing or resolution', async () => {
    let resolved = 0;
    const guardedEnv = {
      CONTROL_PLANE: {
        resolveBridgeCredential: async () => {
          resolved++;
          return { error: 'invalid_token' };
        },
      },
    };
    const response = await worker.fetch(
      new Request('https://bridge.example.test/v1/commands', {
        method: 'POST',
        headers: { authorization: 'Bearer fairlead-token' },
        body: JSON.stringify({ ignored: 'x'.repeat(MAX_JSON_REQUEST_BYTES) }),
      }),
      guardedEnv,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(413);
    expect(resolved).toBe(0);
  });

  it('hands the connector only narrow command fields', async () => {
    const seen: ConnectorCommand[] = [];
    const capturing: Connector = {
      ...connector,
      execute: async (command) => {
        seen.push(command);
        return { idempotencyKey: command.idempotencyKey, ok: true };
      },
    };
    const capturingWorker = createEnvelopeBridgeWorker({
      connectors: new Map([['fixture', () => capturing]]),
    });
    const body = JSON.parse(
      await readFile(join(contract, 'request-create-issue.json'), 'utf8'),
    ) as Record<string, unknown>;
    const response = await capturingWorker.fetch(
      new Request('https://bridge.example.test/v1/commands', {
        method: 'POST',
        headers: { authorization: 'Bearer fairlead-token' },
        body: JSON.stringify(body),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    expect(seen[0]).toMatchObject({ type: 'create_issue', subject: body.subject });
    expect(seen[0]).not.toHaveProperty('report');
    expect(seen[0]).not.toHaveProperty('projectId');
  });

  it('answers an action the resolved connector does not support with 422', async () => {
    const restricted: Connector = {
      ...connector,
      capabilities: { ...connector.capabilities, supportedActions: ['create_issue'] },
    };
    const restrictedWorker = createEnvelopeBridgeWorker({
      connectors: new Map([['fixture', () => restricted]]),
    });
    const body = await readFile(join(contract, 'request-update-issue.json'), 'utf8');
    const response = await restrictedWorker.fetch(
      new Request('https://bridge.example.test/v1/commands', {
        method: 'POST',
        headers: { authorization: 'Bearer fairlead-token' },
        body,
      }),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'unsupported_action' } });
  });

  it('gives connectors a separate, later attachment deadline', async () => {
    let signals: { signal: AbortSignal; attachmentSignal?: AbortSignal } | undefined;
    const spy: Connector = {
      ...connector,
      execute: async (command, options) => {
        signals = options;
        return { idempotencyKey: command.idempotencyKey, ok: true };
      },
    };
    const spyWorker = createEnvelopeBridgeWorker({ connectors: new Map([['fixture', () => spy]]) });
    const body = await readFile(join(contract, 'request-create-issue.json'), 'utf8');
    const response = await spyWorker.fetch(
      new Request('https://bridge.example.test/v1/commands', {
        method: 'POST',
        headers: { authorization: 'Bearer fairlead-token' },
        body,
      }),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    expect(signals?.attachmentSignal).toBeDefined();
    expect(signals?.attachmentSignal).not.toBe(signals?.signal);
  });

  it('authenticates before decoding the command', async () => {
    let resolved = 0;
    const rejecting = {
      CONTROL_PLANE: {
        resolveBridgeCredential: async () => {
          resolved++;
          return { error: 'invalid_token' };
        },
      },
    };
    const body = JSON.parse(
      await readFile(join(contract, 'request-create-issue.json'), 'utf8'),
    ) as Record<string, unknown>;
    body.subject = ''; // would be a 422 if decoded first
    const response = await worker.fetch(
      new Request('https://bridge.example.test/v1/commands', {
        method: 'POST',
        headers: { authorization: 'Bearer bad' },
        body: JSON.stringify(body),
      }),
      rejecting,
      {} as ExecutionContext,
    );
    expect(resolved).toBe(1);
    expect(response.status).toBe(401);
  });

  it('returns the deprecation notice for a version inside its support window', async () => {
    const notice = {
      successorVersion: 2,
      endOfSupportAt: '2027-03-21',
      message: 'v2 is available',
    };
    const deprecated = createEnvelopeBridgeWorker({
      connectors: new Map([['fixture', () => connector]]),
      deprecations: new Map([[1, notice]]),
    });
    const body = await readFile(join(contract, 'request-create-issue.json'), 'utf8');
    const send = (target: typeof worker) =>
      target.fetch(
        new Request('https://bridge.example.test/v1/commands', {
          method: 'POST',
          headers: { authorization: 'Bearer fairlead-token' },
          body,
        }),
        env,
        {} as ExecutionContext,
      );
    expect(await (await send(deprecated)).json()).toMatchObject({
      ok: true,
      metadata: { deprecation: notice },
    });
    expect(await (await send(worker)).json()).not.toHaveProperty('metadata');
  });
});
