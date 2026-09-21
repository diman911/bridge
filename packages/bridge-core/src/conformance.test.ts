import { PROTOCOL_VERSION } from './types.js';
import { runConnectorConformanceTests } from './conformance.js';
import type { Connector } from './connector.js';

// Self-test: the conformance suite must pass against a trivial, correct
// connector — proves the suite itself is usable before a real connector
// package (connector-jira/github/azure-devops) depends on it.
runConnectorConformanceTests((): Connector => ({
  capabilities: {
    protocolVersion: PROTOCOL_VERSION,
    connectorId: 'conformance-fixture',
    displayName: 'Conformance Fixture',
    supportedTargets: ['issue'],
    supportedActions: ['create_issue'],
    verdictMappings: {},
  },
  execute: async (command) =>
    command.type === 'create_issue'
      ? { idempotencyKey: command.idempotencyKey, ok: true }
      : {
          idempotencyKey: command.idempotencyKey,
          ok: false,
          error: { code: 'unsupported_action', message: 'not supported' },
        },
}));
