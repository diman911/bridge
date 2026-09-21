import { describe, expect, it } from 'vitest';
import { COMMAND_OPERATION, supportsCommand } from './capabilities.js';
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
const ALL_COMMANDS = Object.keys(COMMAND_OPERATION) as ('create_issue' | 'update_issue')[];

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
        }
      : {
          protocolVersion: connector.capabilities.protocolVersion,
          type: action,
          issueId: 'conformance-test-id',
          subject: 'Conformance title',
          description: 'Conformance description',
        };

  describe('bridge-core connector conformance', () => {
    it('declares a compatible protocol version', () => {
      const connector = makeConnector();
      expect(isCompatibleProtocolVersion(connector.capabilities.protocolVersion)).toBe(true);
    });

    it('declares at least one target with at least one action', () => {
      const { targets } = makeConnector().capabilities;
      const declared = Object.values(targets).filter((t) => t && t.actions.length > 0);
      expect(declared.length).toBeGreaterThan(0);
    });

    it('implements read/attach for every target that declares them', () => {
      const connector = makeConnector();
      const declared = Object.values(connector.capabilities.targets);
      if (declared.some((t) => t?.reads.length)) expect(typeof connector.read).toBe('function');
      if (declared.some((t) => t?.attachments)) expect(typeof connector.attach).toBe('function');
    });

    it('executes a minimal command for its first declared action without throwing', async () => {
      const connector = makeConnector();
      const first = ALL_COMMANDS.find((type) =>
        supportsCommand(connector.capabilities.targets, type),
      );
      expect(first).toBeDefined();
      const built = command(connector, first!);
      const result = await connector.execute(built, { signal: new AbortController().signal });
      expect(typeof result.ok).toBe('boolean');
    });

    it('answers an undeclared action with a typed failure instead of throwing', async () => {
      const connector = makeConnector();
      const undeclared = ALL_COMMANDS.find(
        (type) => !supportsCommand(connector.capabilities.targets, type),
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
