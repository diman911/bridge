import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from './index.js';
import type { Connector, ConnectorCommand, IntegrationResult } from './index.js';

const command: ConnectorCommand = {
  protocolVersion: PROTOCOL_VERSION,
  type: 'create_issue',
  subject: 'T',
  description: 'D',
  technicalSection: 'Technical details',
  idempotencyKey: 'test-1',
};
const capabilities = {
  protocolVersion: PROTOCOL_VERSION,
  connectorId: 'test-connector',
  displayName: 'Test Connector',
  supportedTargets: ['issue' as const],
  supportedActions: ['create_issue' as const],
  verdictMappings: {},
};

describe('bridge-core contract', () => {
  it('lets a minimal in-memory Connector implementation type-check and run', async () => {
    const connector: Connector = {
      capabilities,
      execute(input: ConnectorCommand): Promise<IntegrationResult> {
        return Promise.resolve({ idempotencyKey: input.idempotencyKey, ok: true });
      },
    };
    const result = await connector.execute(command, { signal: new AbortController().signal });
    expect(result).toEqual({ idempotencyKey: 'test-1', ok: true });
  });

  it('reports a partial-success result with a per-attachment failure', async () => {
    const connector: Connector = {
      capabilities,
      execute: (input) =>
        Promise.resolve({
          idempotencyKey: input.idempotencyKey,
          ok: true,
          issueUrl: 'https://example.test/issue/1',
          attachments: [
            {
              filename: 'network.har',
              ok: false,
              error: { code: 'attachment_too_large', message: 'exceeds provider limit' },
            },
          ],
        }),
    };
    const result = await connector.execute(command, { signal: new AbortController().signal });
    expect(result.ok).toBe(true);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments?.[0].ok).toBe(false);
  });
});
