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
});
