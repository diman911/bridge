import { describe, expect, it } from 'vitest';
import { isCompatibleProtocolVersion } from './types.js';
import { validateIntegrationCommand } from './validation.js';
import type { Connector } from './connector.js';
import type { IntegrationAction, IntegrationCommand, TargetReference } from './types.js';

function makeTargetReference(kind: TargetReference['kind']): TargetReference {
  return kind === 'none' ? { kind: 'none' } : { kind, id: 'conformance-test-id' };
}

/** `transition_issue` carries a required `toStatus`; every other action type is bare. */
function makeAction(type: IntegrationAction['type']): IntegrationAction {
  return type === 'transition_issue' ? { type, toStatus: 'Done' } : { type };
}

/**
 * Conformance suite a connector package (connector-jira, connector-github,
 * connector-azure-devops, ...) imports and runs against its own
 * `execute()` — see docs/plans/01-stabilize-contract.md's acceptance
 * criteria. Checks the contract-level shape every connector must honor;
 * it does not check provider-specific correctness (real API calls,
 * field-mapping fidelity, ...), which belongs in that connector's own
 * tests.
 *
 * Usage in a connector package's test file:
 *   import { runConnectorConformanceTests } from '@fairlead/bridge-core/conformance';
 *   runConnectorConformanceTests(() => new MyConnector());
 */
export function runConnectorConformanceTests(makeConnector: () => Connector): void {
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

    it('executes a minimal command built from its own declared capabilities without throwing', async () => {
      const connector = makeConnector();
      const command: IntegrationCommand = {
        protocolVersion: connector.capabilities.protocolVersion,
        target: makeTargetReference(connector.capabilities.supportedTargets[0]),
        outcome: 'observation',
        actions: [makeAction(connector.capabilities.supportedActions[0])],
        idempotencyKey: 'conformance-test-key',
        callerId: 'conformance-test-caller',
        connectorId: connector.capabilities.connectorId,
      };

      expect(validateIntegrationCommand(command)).toEqual({ ok: true });

      const result = await connector.execute(command, { signal: new AbortController().signal });
      expect(result.idempotencyKey).toBe(command.idempotencyKey);
      expect(typeof result.ok).toBe('boolean');
    });
  });
}
