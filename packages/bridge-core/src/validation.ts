import { isCompatibleProtocolVersion } from './types.js';
import type { IntegrationAction, IntegrationCommand, IntegrationError, TargetReference } from './types.js';

const TARGET_KINDS: ReadonlyArray<TargetReference['kind']> = [
  'issue',
  'test_case',
  'test_run',
  'incident',
  'none',
];

const OUTCOMES: ReadonlyArray<IntegrationCommand['outcome']> = [
  'passed',
  'failed',
  'blocked',
  'incomplete',
  'verified',
  'not_verified',
  'observation',
];

const ACTION_TYPES: ReadonlyArray<IntegrationAction['type']> = [
  'create_issue',
  'update_issue',
  'transition_issue',
  'add_comment',
  'attach_evidence',
  'write_test_result',
  'share_only',
];

function err(code: string, message: string): { error: IntegrationError } {
  return { error: { code, message } };
}

/**
 * Rejects a malformed or incompatible command with a typed error rather
 * than letting a connector's execute() throw on an assumption it didn't
 * check itself. Does not validate that the command's `actions`/`target`
 * are ones the *specific* connector supports — that's a capability-manifest
 * check the caller (bridge-worker) makes against the resolved connector's
 * `ConnectorCapabilities`, not a shape concern this function owns.
 */
export function validateIntegrationCommand(
  command: IntegrationCommand,
): { ok: true } | { error: IntegrationError } {
  if (!isCompatibleProtocolVersion(command.protocolVersion)) {
    return err(
      'unsupported_protocol_version',
      `command protocolVersion ${command.protocolVersion} is not supported`,
    );
  }
  if (!TARGET_KINDS.includes(command.target.kind)) {
    return err('invalid_target', `unknown target kind "${command.target.kind}"`);
  }
  if (!OUTCOMES.includes(command.outcome)) {
    return err('invalid_outcome', `unknown outcome "${command.outcome}"`);
  }
  if (!Array.isArray(command.actions) || command.actions.length === 0) {
    return err('invalid_actions', 'actions must be a non-empty array');
  }
  for (const action of command.actions) {
    if (!ACTION_TYPES.includes(action.type)) {
      return err('invalid_actions', `unknown action type "${action.type}"`);
    }
  }
  if (!command.idempotencyKey) {
    return err('missing_idempotency_key', 'idempotencyKey is required');
  }
  if (!command.callerId) {
    return err('missing_caller_id', 'callerId is required');
  }
  if (!command.connectorId) {
    return err('missing_connector_id', 'connectorId is required');
  }
  return { ok: true };
}
