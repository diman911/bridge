import { describe, expect, it } from 'vitest';
import type { Connector, IntegrationCommand, IntegrationResult } from './index.js';

describe('bridge-core contract', () => {
  it('lets a minimal in-memory Connector implementation type-check and run', async () => {
    const connector: Connector = {
      capabilities: {
        connectorId: 'test-connector',
        displayName: 'Test Connector',
        supportedTargets: ['issue'],
        supportedActions: ['create_issue'],
        verdictMappings: { failed: 'Bug' },
      },
      execute(command: IntegrationCommand): Promise<IntegrationResult> {
        return Promise.resolve({ idempotencyKey: command.idempotencyKey, ok: true });
      },
    };

    const result = await connector.execute({
      target: { kind: 'none' },
      outcome: 'observation',
      actions: [{ type: 'create_issue' }],
      idempotencyKey: 'test-1',
      callerId: 'test-user',
      connectorId: connector.capabilities.connectorId,
    });

    expect(result).toEqual({ idempotencyKey: 'test-1', ok: true });
  });
});
