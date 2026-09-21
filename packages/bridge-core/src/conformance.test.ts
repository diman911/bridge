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
    targets: { issue: { actions: ['create'], reads: [] } },
  },
  execute: async (command) =>
    command.type === 'create_issue'
      ? { ok: true }
      : {
          ok: false,
          error: { code: 'unsupported_action', message: 'not supported' },
        },
}));
