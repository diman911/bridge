import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, validateIntegrationCommand } from './index.js';
import type { Connector, IntegrationCommand, IntegrationResult } from './index.js';

describe('bridge-core contract', () => {
  it('lets a minimal in-memory Connector implementation type-check and run', async () => {
    const connector: Connector = {
      capabilities: {
        protocolVersion: PROTOCOL_VERSION,
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

    const result = await connector.execute(
      {
        protocolVersion: PROTOCOL_VERSION,
        target: { kind: 'none' },
        outcome: 'observation',
        actions: [{ type: 'create_issue' }],
        idempotencyKey: 'test-1',
        callerId: 'test-user',
        connectorId: connector.capabilities.connectorId,
      },
      { signal: new AbortController().signal },
    );

    expect(result).toEqual({ idempotencyKey: 'test-1', ok: true });
  });

  it('reports a partial-success result with a per-attachment failure', async () => {
    const connector: Connector = {
      capabilities: {
        protocolVersion: PROTOCOL_VERSION,
        connectorId: 'test-connector',
        displayName: 'Test Connector',
        supportedTargets: ['issue'],
        supportedActions: ['create_issue'],
        verdictMappings: {},
      },
      execute(command: IntegrationCommand): Promise<IntegrationResult> {
        return Promise.resolve({
          idempotencyKey: command.idempotencyKey,
          ok: true,
          issueUrl: 'https://example.test/issue/1',
          attachments: [
            {
              reference: {
                mode: 'data_plane_reference',
                sessionUrl: 'https://dp.example.test/s/1',
              },
              ok: false,
              error: { code: 'attachment_too_large', message: 'exceeds provider limit' },
            },
          ],
        });
      },
    };

    const result = await connector.execute(
      {
        protocolVersion: PROTOCOL_VERSION,
        target: { kind: 'issue', id: 'ISSUE-1' },
        outcome: 'failed',
        actions: [{ type: 'create_issue' }],
        evidence: { mode: 'data_plane_reference', sessionUrl: 'https://dp.example.test/s/1' },
        idempotencyKey: 'test-2',
        callerId: 'test-user',
        connectorId: connector.capabilities.connectorId,
      },
      { signal: new AbortController().signal },
    );

    expect(result.ok).toBe(true);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments?.[0].ok).toBe(false);
  });

  it('rejects a command with an incompatible protocol version', () => {
    const result = validateIntegrationCommand({
      protocolVersion: PROTOCOL_VERSION + 1,
      target: { kind: 'none' },
      outcome: 'observation',
      actions: [{ type: 'create_issue' }],
      idempotencyKey: 'test-3',
      callerId: 'test-user',
      connectorId: 'test-connector',
    });

    expect(result).toEqual({
      error: { code: 'unsupported_protocol_version', message: expect.any(String) },
    });
  });

  it('rejects a command with an empty actions array', () => {
    const result = validateIntegrationCommand({
      protocolVersion: PROTOCOL_VERSION,
      target: { kind: 'none' },
      outcome: 'observation',
      actions: [],
      idempotencyKey: 'test-4',
      callerId: 'test-user',
      connectorId: 'test-connector',
    });

    expect(result).toEqual({ error: { code: 'invalid_actions', message: expect.any(String) } });
  });

  it('accepts a well-formed command', () => {
    const result = validateIntegrationCommand({
      protocolVersion: PROTOCOL_VERSION,
      target: { kind: 'issue', id: 'ISSUE-1' },
      outcome: 'failed',
      actions: [{ type: 'create_issue' }],
      idempotencyKey: 'test-5',
      callerId: 'test-user',
      connectorId: 'test-connector',
    });

    expect(result).toEqual({ ok: true });
  });
});
