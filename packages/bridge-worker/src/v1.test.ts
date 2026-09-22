import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAX_JSON_REQUEST_BYTES,
  MAX_ATTACHMENT_BYTES,
  ATTACHMENT_INTEGRATION_INSTANCE_ID_HEADER,
  ATTACHMENT_PROJECT_ID_HEADER,
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
    targets: { issue: { actions: ['create', 'update'], reads: [] } },
  },
  execute: async () => ({
    ok: true,
    issueUrl: 'https://tracker.example.test/browse/APP-43',
  }),
};
const worker = createEnvelopeBridgeWorker({ connectors: new Map([['fixture', () => connector]]) });
const env = {
  CONTROL_PLANE: {
    resolveBridgeCredential: async () => ({
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

function multipart(meta: Record<string, unknown>, file: Uint8Array, boundary = 'test-boundary') {
  const prefix = new TextEncoder().encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${String(meta.filename)}"\r\nContent-Type: ${String(meta.contentType)}\r\n\r\n`,
  );
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(prefix.byteLength + file.byteLength + suffix.byteLength);
  body.set(prefix);
  body.set(file, prefix.byteLength);
  body.set(suffix, prefix.byteLength + file.byteLength);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

const attachmentMeta = {
  protocolVersion: 1,
  issueId: 'APP-42',
  filename: 'capture.har',
  contentType: 'application/x-http-archive',
};
const attachmentRoutingHeaders = {
  [ATTACHMENT_PROJECT_ID_HEADER]: 'project-123',
  [ATTACHMENT_INTEGRATION_INSTANCE_ID_HEADER]: 'tracker-456',
};

describe('v1 frozen contract fixtures', () => {
  it('resolves the provider credential and runs the connector credential check', async () => {
    const checked: AbortSignal[] = [];
    const credentialConnector: Connector = {
      ...connector,
      checkCredential: async (signal) => {
        checked.push(signal!);
        return true;
      },
    };
    const handler = createEnvelopeBridgeWorker({
      connectors: new Map([['fixture', () => credentialConnector]]),
    });
    const response = await handler.fetch(
      new Request('https://bridge.example.test/v1/credentials/check', {
        method: 'POST',
        headers: { authorization: 'Bearer fairlead-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          protocolVersion: 1,
          project_id: 'project-123',
          integration_instance_id: 'tracker-456',
        }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: true });
    expect(checked).toHaveLength(1);
    expect(checked[0]).toBeInstanceOf(AbortSignal);
  });

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
        return { ok: true };
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
      capabilities: {
        ...connector.capabilities,
        targets: { issue: { actions: ['create'], reads: [] } },
      },
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

describe('connector configuration', () => {
  it('answers 422 connector_not_configured when the connector factory rejects the resolved config', async () => {
    const throwing = createEnvelopeBridgeWorker({
      connectors: new Map([
        [
          'fixture',
          () => {
            throw new Error('missing trusted connector container_key');
          },
        ],
      ]),
    });
    const body = await readFile(join(contract, 'request-create-issue.json'), 'utf8');
    const response = await throwing.fetch(
      new Request('https://bridge.example.test/v1/commands', {
        method: 'POST',
        headers: { authorization: 'Bearer fairlead-token' },
        body,
      }),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'connector_not_configured' } });
  });
});

describe('request timeout', () => {
  it('uses the timeout returned by Control Plane for connector execution', async () => {
    const slow: Connector = {
      ...connector,
      execute: async (_command, { signal }) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ ok: true }), 2_000);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    };
    const target = createEnvelopeBridgeWorker({
      connectors: new Map([['fixture', () => slow]]),
    });
    const body = await readFile(join(contract, 'request-create-issue.json'), 'utf8');
    const response = await target.fetch(
      new Request('https://bridge.example.test/v1/commands', {
        method: 'POST',
        headers: { authorization: 'Bearer fairlead-token' },
        body,
      }),
      {
        CONTROL_PLANE: {
          resolveBridgeCredential: async () => ({
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
            request_timeout_seconds: 1,
          }),
        },
      },
      {} as ExecutionContext,
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ error: { code: 'request_timeout' } });
  });
});

describe('unsupported protocol version', () => {
  const routing = { project_id: 'project-123', integration_instance_id: 'tracker-456' };
  const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) =>
    worker.fetch(
      new Request(`https://bridge.example.test${path}`, {
        method: 'POST',
        headers: { authorization: 'Bearer fairlead-token', ...headers },
        body,
      }),
      env,
      {} as ExecutionContext,
    );

  it.each([
    ['/v1/commands', { type: 'create_issue', subject: 'S', description: 'D' }],
    ['/v1/reads', { operation: { type: 'fetch', id: '1' } }],
  ])('answers 400 unsupported_protocol_version on %s', async (path, payload) => {
    const response = await post(
      path,
      JSON.stringify({ protocolVersion: 99, ...routing, ...payload }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'unsupported_protocol_version' },
    });
  });

  it('answers 400 unsupported_protocol_version on /v1/attachments', async () => {
    const requestBody = multipart(
      { ...attachmentMeta, protocolVersion: 99 },
      new TextEncoder().encode('x'),
    );
    const response = await post('/v1/attachments', requestBody.body, {
      ...attachmentRoutingHeaders,
      'content-type': requestBody.contentType,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'unsupported_protocol_version' },
    });
  });
});

describe('POST /v1/attachments', () => {
  it('requires routing headers before reading multipart bytes', async () => {
    const response = await worker.fetch(
      new Request('https://bridge.example.test/v1/attachments', {
        method: 'POST',
        headers: {
          authorization: 'Bearer fairlead-token',
          'content-type': 'not-multipart',
        },
        body: 'would fail multipart parsing',
      }),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_attachment_routing' } });
  });

  it('resolves credentials before reading any multipart bytes', async () => {
    const response = await worker.fetch(
      new Request('https://bridge.example.test/v1/attachments', {
        method: 'POST',
        headers: {
          authorization: 'Bearer invalid',
          ...attachmentRoutingHeaders,
          'content-type': 'not-multipart',
        },
        body: 'would fail multipart parsing',
      }),
      {
        CONTROL_PLANE: {
          resolveBridgeCredential: async () => ({ error: 'invalid_token' }),
        },
      },
      {} as ExecutionContext,
    );
    expect(response.status).toBe(401);
  });

  it('resolves credentials before meta and streams one file to the connector', async () => {
    const events: string[] = [];
    let received = '';
    const attaching: Connector = {
      ...connector,
      attach: async (attachment) => {
        events.push('attach');
        const chunks: Uint8Array[] = [];
        const reader = attachment.data.getReader();
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          chunks.push(next.value);
        }
        received = new TextDecoder().decode(chunks[0]);
        return { filename: attachment.filename, ok: true };
      },
    };
    const target = createEnvelopeBridgeWorker({
      connectors: new Map([['fixture', () => attaching]]),
    });
    const requestBody = multipart(attachmentMeta, new TextEncoder().encode('file bytes'));
    const response = await target.fetch(
      new Request('https://bridge.example.test/v1/attachments', {
        method: 'POST',
        headers: {
          authorization: 'Bearer fairlead-token',
          ...attachmentRoutingHeaders,
          'content-type': requestBody.contentType,
        },
        body: requestBody.body,
      }),
      {
        CONTROL_PLANE: {
          resolveBridgeCredential: async (...args) => {
            events.push('resolve');
            return env.CONTROL_PLANE.resolveBridgeCredential(...args);
          },
        },
      },
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      filename: attachmentMeta.filename,
      ok: true,
    });
    expect(events).toEqual(['resolve', 'attach']);
    expect(received).toBe('file bytes');
  });

  it('requires meta to be the first part', async () => {
    const boundary = 'wrong-order';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nx\r\n--${boundary}--\r\n`;
    const response = await worker.fetch(
      new Request('https://bridge.example.test/v1/attachments', {
        method: 'POST',
        headers: {
          authorization: 'Bearer fairlead-token',
          ...attachmentRoutingHeaders,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      }),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_multipart' } });
  });

  it('returns a structured 413 when streamed bytes exceed the attachment limit', async () => {
    const consuming: Connector = {
      ...connector,
      attach: async (attachment) => {
        try {
          const reader = attachment.data.getReader();
          while (!(await reader.read()).done) {
            // Consume as the provider fetch would.
          }
          return { filename: attachment.filename, ok: true };
        } catch {
          return {
            filename: attachment.filename,
            ok: false,
            error: { code: 'attachment_too_large', message: 'attachment exceeds limit' },
          };
        }
      },
    };
    const target = createEnvelopeBridgeWorker({
      connectors: new Map([['fixture', () => consuming]]),
    });
    const requestBody = multipart(attachmentMeta, new Uint8Array(MAX_ATTACHMENT_BYTES + 1));
    const response = await target.fetch(
      new Request('https://bridge.example.test/v1/attachments', {
        method: 'POST',
        headers: {
          authorization: 'Bearer fairlead-token',
          ...attachmentRoutingHeaders,
          'content-type': requestBody.contentType,
        },
        body: requestBody.body,
      }),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'attachment_too_large',
        limitBytes: MAX_ATTACHMENT_BYTES,
        actualBytes: MAX_ATTACHMENT_BYTES + 1,
      },
    });
  });
});
