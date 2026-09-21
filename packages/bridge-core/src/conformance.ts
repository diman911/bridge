import { describe, expect, it } from 'vitest';
import { isCompatibleProtocolVersion } from './types.js';
import type { Connector } from './connector.js';
import type { ConnectorCommand } from './command.js';

/**
 * Conformance suite a connector package (connector-jira, connector-github,
 * connector-azure-devops, ...) imports and runs against its own
 * `execute()`. Checks the contract-level shape every connector must honor;
 * it does not check provider-specific correctness (real API calls,
 * field-mapping fidelity, ...), which belongs in that connector's own
 * tests.
 *
 * Usage in a connector package's test file:
 *   import { runConnectorConformanceTests } from '@fairlead/bridge-core/conformance';
 *   runConnectorConformanceTests(() => new MyConnector());
 */
export function runConnectorConformanceTests(makeConnector: () => Connector): void {
  const command = (
    connector: Connector,
    action: 'create_issue' | 'update_issue',
  ): ConnectorCommand =>
    action === 'create_issue'
      ? {
          protocolVersion: connector.capabilities.protocolVersion,
          type: action,
          subject: 'Conformance title',
          description: 'Conformance description',
          technicalSection: 'Conformance technical section',
          idempotencyKey: 'conformance-test-key',
        }
      : {
          protocolVersion: connector.capabilities.protocolVersion,
          type: action,
          issueId: 'conformance-test-id',
          subject: 'Conformance title',
          description: 'Conformance description',
          technicalSection: 'Conformance technical section',
          idempotencyKey: 'conformance-test-key',
        };

  describe('bridge-core connector conformance', () => {
    it('declares a compatible protocol version', () => {
      const connector = makeConnector();
      expect(isCompatibleProtocolVersion(connector.capabilities.protocolVersion)).toBe(true);
    });

    it('declares at least one supported target and action', () => {
      const connector = makeConnector();
      expect(connector.capabilities.supportedTargets.length).toBeGreaterThan(0);
      expect(connector.capabilities.supportedActions.length).toBeGreaterThan(0);
    });

    it('executes a minimal command for its first declared action without throwing', async () => {
      const connector = makeConnector();
      const built = command(connector, connector.capabilities.supportedActions[0]);
      const result = await connector.execute(built, { signal: new AbortController().signal });
      expect(result.idempotencyKey).toBe(built.idempotencyKey);
      expect(typeof result.ok).toBe('boolean');
    });

    it('answers an undeclared action with a typed failure instead of throwing', async () => {
      const connector = makeConnector();
      const undeclared = (['create_issue', 'update_issue'] as const).find(
        (action) => !connector.capabilities.supportedActions.includes(action),
      );
      if (!undeclared) return;
      const result = await connector.execute(command(connector, undeclared), {
        signal: new AbortController().signal,
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('unsupported_action');
    });
  });
}
